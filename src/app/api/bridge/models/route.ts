import { NextResponse } from 'next/server';
import { BridgeError, bridgeConfigured } from '@/lib/bridge/config';
import { upstreamModels } from '@/lib/bridge/ollama';
import { guard } from '@/lib/server/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/bridge/models — proxy the upstream model list. */
export async function GET(request: Request): Promise<Response> {
  if (!bridgeConfigured()) {
    return NextResponse.json({ error: 'Bridge not configured.' }, { status: 500 });
  }
  // Polled by the connection indicator, so the ceiling is higher than /chat.
  const gate = await guard(request, { bucket: 'models', limit: 120, windowMs: 60_000 });
  if (!gate.ok) return gate.response;

  try {
    const res = await upstreamModels(request.signal);
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
