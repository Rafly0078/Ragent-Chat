import { NextResponse } from 'next/server';
import { BridgeError, bridgeConfigured } from '@/lib/bridge/config';
import { upstreamShow } from '@/lib/bridge/ollama';
import { guard } from '@/lib/server/guard';
import { bodyErrorResponse, readJson } from '@/lib/server/body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/bridge/show { name } — proxy Ollama /api/show for model details. */
export async function POST(request: Request): Promise<Response> {
  if (!bridgeConfigured()) {
    return NextResponse.json({ error: 'Bridge not configured.' }, { status: 500 });
  }
  const gate = await guard(request, { bucket: 'show', limit: 120, windowMs: 60_000 });
  if (!gate.ok) return gate.response;

  let name = '';
  try {
    const body = await readJson<{ name?: string; model?: string }>(request, 16 * 1024);
    name = (body.name ?? body.model ?? '').trim();
  } catch (err) {
    return bodyErrorResponse(err) ?? NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!name) return NextResponse.json({ error: 'Missing model name.' }, { status: 400 });

  try {
    const res = await upstreamShow(name, request.signal);
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
    });
  } catch (err) {
    const status = err instanceof BridgeError ? err.status : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upstream error.' },
      { status },
    );
  }
}
