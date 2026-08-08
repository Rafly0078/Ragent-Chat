import { NextResponse } from 'next/server';
import { bodyErrorResponse, readJson } from '@/lib/server/body';
import { guard } from '@/lib/server/guard';
import { ProviderError, providerModels } from '@/lib/providers/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request): Promise<Response> {
  const gate = await guard(request, { bucket: 'provider-models', limit: 120, windowMs: 60_000 });
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await readJson(request, MAX_BODY_BYTES);
  } catch (error) {
    return (
      bodyErrorResponse(error) ??
      NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    );
  }

  try {
    return NextResponse.json(
      await providerModels(body as Record<string, unknown>, request.signal),
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Provider request failed.' },
      { status: error instanceof ProviderError ? error.status : 502 },
    );
  }
}
