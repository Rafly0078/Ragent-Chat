import { NextResponse } from 'next/server';
import type { SearchResponse, SearchResult } from '@/lib/search/types';
import { guard } from '@/lib/server/guard';
import { bodyErrorResponse, readJson } from '@/lib/server/body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/search — web search via Tavily.
 *
 * The API key is server-only (TAVILY_API_KEY) so it never ships to the browser.
 * We request `include_raw_content` so a single upstream call returns both the
 * snippet and cleaned page text — no separate page-fetch round trip needed.
 *
 * Body: { query: string; maxResults?: number }
 * Returns: SearchResponse (provider-agnostic; see lib/search/types.ts).
 *
 * Gated + rate limited: each call costs the owner a metered Tavily credit, so an
 * unauthenticated caller could previously drain the quota in a loop.
 */

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const DEFAULT_MAX_RESULTS = 5;
const HARD_MAX_RESULTS = 8;
const UPSTREAM_TIMEOUT_MS = 20_000;
/** Tavily rejects very long queries anyway; truncate rather than round-trip. */
const MAX_QUERY_CHARS = 400;
/**
 * Ceiling on the cleaned page text we forward per result. `include_raw_content`
 * returns whole page bodies, and forwarding them untruncated meant a 3-query
 * plan shipped 15 of them to the browser — hundreds of KB to megabytes — for a
 * consumer that keeps 1500 characters of the top 5 (MAX_CONTENT_CHARS_PER_RESULT
 * in lib/search/format.ts) and persists none of the rest. The headroom over
 * 1500 is so that cap can move a little without a matching change here.
 */
const MAX_CONTENT_CHARS = 2_000;

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string | null;
  score?: number;
}
interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Web search is not configured. Set TAVILY_API_KEY on the server.' },
      { status: 501 },
    );
  }

  const gate = await guard(request, { bucket: 'search', limit: 20, windowMs: 60_000 });
  if (!gate.ok) return gate.response;

  let body: { query?: string; maxResults?: number };
  try {
    body = await readJson<{ query?: string; maxResults?: number }>(request, 64 * 1024);
  } catch (err) {
    return (
      bodyErrorResponse(err) ?? NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    );
  }

  const query = body.query?.trim().slice(0, MAX_QUERY_CHARS);
  if (!query) {
    return NextResponse.json({ error: 'Missing "query".' }, { status: 400 });
  }
  const requested = Number(body.maxResults);
  const maxResults = Number.isFinite(requested)
    ? Math.min(Math.max(1, Math.floor(requested)), HARD_MAX_RESULTS)
    : DEFAULT_MAX_RESULTS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  // Abort upstream if the client disconnects mid-search.
  request.signal.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const upstream = await fetch(TAVILY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'advanced',
        include_answer: true,
        include_raw_content: true,
        max_results: maxResults,
      }),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      // Don't forward the provider's raw error body to the browser — it can
      // contain account/quota details. Log it, return a generic message.
      const detail = await upstream.text().catch(() => '');
      console.error(`[search] Tavily returned ${upstream.status}:`, detail.slice(0, 500));
      return NextResponse.json(
        { error: `Search provider error (${upstream.status}).` },
        { status: 502 },
      );
    }

    const data = (await upstream.json()) as TavilyResponse;
    const results: SearchResult[] = (data.results ?? [])
      .filter((r): r is TavilyResult & { url: string } => Boolean(r.url))
      .map((r) => ({
        title: r.title?.trim() || r.url,
        url: r.url,
        snippet: r.content?.trim() ?? '',
        content: r.raw_content?.trim().slice(0, MAX_CONTENT_CHARS) || undefined,
        score: r.score,
      }));

    const payload: SearchResponse = { query, answer: data.answer?.trim(), results };
    return NextResponse.json(payload, { status: 200 });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return NextResponse.json(
      { error: aborted ? 'Search timed out.' : 'Search failed.' },
      { status: aborted ? 504 : 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
