import { NextResponse } from 'next/server';
import { BridgeError, bridgeConfigured } from '@/lib/bridge/config';
import { upstreamModels } from '@/lib/bridge/ollama';
import { publicApiAuthorized, publicApiConfigured, publicApiUnauthorized } from '@/lib/api/public-auth';
import { clientKey, hit, tooManyRequests } from '@/lib/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  if (!publicApiConfigured()) return NextResponse.json({ error: { message: 'Public API is not configured.' } }, { status: 503 });
  const rate = hit(`public-api-models:${clientKey(request)}`, 120, 60_000);
  if (!rate.ok) return tooManyRequests(rate);
  if (!publicApiAuthorized(request)) return publicApiUnauthorized();
  if (!bridgeConfigured()) return NextResponse.json({ error: { message: 'Model backend is not configured.' } }, { status: 503 });
  try {
    const response = await upstreamModels(request.signal);
    const body = (await response.json()) as { models?: { name?: string; model?: string }[] };
    return NextResponse.json({ object: 'list', data: (body.models ?? []).map((item) => ({ id: item.name || item.model, object: 'model', owned_by: 'ollama' })) }, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof BridgeError ? error.message : 'Model request failed.' } }, { status: error instanceof BridgeError ? error.status : 502 });
  }
}
