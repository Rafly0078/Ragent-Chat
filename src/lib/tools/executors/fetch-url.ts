import 'server-only';

import { assertPublicUrl, BlockedUrlError } from '@/lib/server/public-url';
import type { GenerateRequest } from '../types';

/**
 * Read a web page and hand its text back to the model.
 *
 * The first tool here that RETURNS something rather than producing a file. Web
 * search existed already, but only as a fixed pre-pass: a planner decided the
 * queries before the answer started, and the model could never say "fetch this
 * specific page". Tavily already returns cleaned page text, so the capability was
 * present and simply unreachable.
 *
 * Every URL is vetted by `assertPublicUrl` first, and again after each redirect.
 * A tool that fetches a model-chosen URL from inside the deployment is the
 * textbook SSRF surface — cloud metadata at 169.254.169.254 being the first
 * target — and a public hostname that redirects to a private address is the
 * standard way around a single up-front check.
 */

/** Per-hop and total budgets. A tool call must not be able to hang a request. */
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 4;
const MAX_BYTES = 3 * 1024 * 1024;
const DEFAULT_MAX_CHARS = 40_000;
const HARD_MAX_CHARS = 200_000;

/** Content types worth converting to text. Anything else is reported, not parsed. */
const TEXTUAL = /^(?:text\/|application\/(?:json|xml|xhtml\+xml|javascript|x-ndjson))/i;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
  '#x27': "'",
  mdash: '—',
  ndash: '–',
  hellip: '…',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    const key = code.toLowerCase();
    if (ENTITIES[key] !== undefined) return ENTITIES[key];
    if (key.startsWith('#x')) {
      const n = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    if (key.startsWith('#')) {
      const n = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return whole;
  });
}

/**
 * HTML → readable text. Not a parser: script/style/nav chrome is dropped, block
 * boundaries become newlines, everything else is stripped. Good enough to answer
 * questions from, and it can't execute anything.
 *
 * Exported so it can be checked against fixtures — asserting on the live copy of
 * a remote page is a test that breaks when someone else edits their website.
 */
export function htmlToText(html: string): { title?: string; text: string } {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
  const text = decodeEntities(
    html
      // Chrome that is never the content the model asked for.
      .replace(/<(script|style|noscript|template|svg|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ')
      // Keep structure the reader depends on before dropping tags.
      .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)>/gi, '\n')
      .replace(/<br\b[^>]*\/?>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { ...(title ? { title } : {}), text };
}

/** Read at most `MAX_BYTES`, so a huge file can't be buffered whole. */
async function readCapped(res: Response): Promise<{ body: string; truncated: boolean }> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BYTES * 4) {
    throw new Error(`That resource is too large (${Math.round(declared / 1024)} KB).`);
  }
  if (!res.body) return { body: '', truncated: false };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  let bytes = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        out += decoder.decode(value.slice(0, Math.max(0, value.byteLength - (bytes - MAX_BYTES))));
        truncated = true;
        break;
      }
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return { body: out, truncated };
}

/**
 * Follow redirects by hand, vetting every hop. `redirect: 'follow'` would let a
 * public URL land on 127.0.0.1 without the guard ever seeing it.
 */
async function fetchVetted(start: URL, signal: AbortSignal): Promise<{ res: Response; url: URL }> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(url, {
      redirect: 'manual',
      signal,
      headers: {
        // Identify honestly, and ask for text.
        'User-Agent': 'Mozilla/5.0 (compatible; RagentBot/1.0; +https://github.com/Rafly0078)',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en,*;q=0.5',
      },
    });
    if (res.status < 300 || res.status >= 400) return { res, url };

    const location = res.headers.get('location');
    if (!location) return { res, url };
    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      throw new Error('The server redirected to an invalid URL.');
    }
    // Re-vet: this is the hop a single up-front check would have missed.
    url = await assertPublicUrl(next.toString(), { allowQuery: true, allowHttp: true });
  }
  throw new Error(`Too many redirects (more than ${MAX_REDIRECTS}).`);
}

export default async function fetchUrl(req: GenerateRequest): Promise<{ text: string }> {
  const raw = typeof req.url === 'string' ? req.url.trim() : '';
  if (!raw) throw new Error('fetch_url needs a "url".');

  const cap = Math.min(
    typeof req.maxChars === 'number' && req.maxChars > 0 ? req.maxChars : DEFAULT_MAX_CHARS,
    HARD_MAX_CHARS,
  );

  let url: URL;
  try {
    url = await assertPublicUrl(raw, { allowQuery: true, allowHttp: true });
  } catch (err) {
    // Surfaced to the MODEL as a tool result, so it reads as an instruction it
    // can act on rather than a stack trace.
    if (err instanceof BlockedUrlError) throw new Error(`Cannot fetch that URL: ${err.message}`);
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const { res, url: finalUrl } = await fetchVetted(url, controller.signal);
    if (!res.ok) {
      throw new Error(`The server returned ${res.status} ${res.statusText || ''}`.trim() + '.');
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (!TEXTUAL.test(contentType)) {
      throw new Error(
        `That URL is ${contentType || 'an unknown type'}, not a document this tool can read.`,
      );
    }

    const { body, truncated: bodyTruncated } = await readCapped(res);
    const isHtml = /html/i.test(contentType);
    const parsed = isHtml ? htmlToText(body) : { text: body.trim() };

    let text = parsed.text;
    let clipped = bodyTruncated;
    if (text.length > cap) {
      text = text.slice(0, cap);
      clipped = true;
    }
    if (!text) throw new Error('That page had no readable text.');

    const header = [
      `Fetched: ${finalUrl.toString()}`,
      ...(finalUrl.toString() !== url.toString() ? [`(redirected from ${url.toString()})`] : []),
      ...(parsed.title ? [`Title: ${parsed.title}`] : []),
      ...(clipped ? [`Note: truncated at ${cap} characters.`] : []),
    ].join('\n');

    return { text: `${header}\n\n${text}` };
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`That URL did not respond within ${FETCH_TIMEOUT_MS / 1000}s.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
