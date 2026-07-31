import { NextResponse } from 'next/server';
import { BridgeError, bridgeConfigured } from '@/lib/bridge/config';
import { upstreamChat } from '@/lib/bridge/ollama';
import { guard } from '@/lib/server/guard';
import { bodyErrorResponse, readJson } from '@/lib/server/body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Chat payloads carry base64 images for vision models, so the cap is generous. */
const MAX_BODY_BYTES = 24 * 1024 * 1024;

/**
 * POST /api/bridge/chat — proxy a chat completion (streaming or not).
 * Streams the upstream body straight through so tokens reach the client with
 * no added buffering. The frontend's stream parser is unchanged.
 *
 * Gated: this route spends the owner's GPU. Without the guard it was an open
 * inference proxy for anyone who found the deployment URL.
 */
export async function POST(request: Request): Promise<Response> {
  if (!bridgeConfigured()) {
    return NextResponse.json({ error: 'Bridge not configured.' }, { status: 500 });
  }

  const gate = await guard(request, { bucket: 'chat', limit: 60, windowMs: 60_000 });
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await readJson<unknown>(request, MAX_BODY_BYTES);
  } catch (err) {
    return (
      bodyErrorResponse(err) ?? NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    );
  }

  try {
    const res = await upstreamChat(body, request.signal);
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      return new NextResponse(text || JSON.stringify({ error: 'Upstream error.' }), {
        status: res.ok ? 502 : res.status,
        headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
      });
    }
    return new NextResponse(res.body, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('content-type') ?? 'application/x-ndjson',
        'Cache-Control': 'no-store, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    const status = err instanceof BridgeError ? err.status : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upstream error.' },
      { status },
    );
  }
}
