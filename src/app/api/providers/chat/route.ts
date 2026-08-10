import { NextResponse } from 'next/server';
import type { ChatRequest } from '@/lib/api/types';
import { bodyErrorResponse, readJson } from '@/lib/server/body';
import { guard } from '@/lib/server/guard';
import { ProviderError, providerChat, type ProviderInput } from '@/lib/providers/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A chat completion streams for as long as the model keeps writing, and this
 * route is the proxy in between — so the platform's default function timeout is
 * the real ceiling on a long answer, not anything in our code. Declared
 * explicitly rather than left to the deployment default, which is short enough
 * that a reasoning model at high effort gets killed mid-generation and surfaces
 * as a 504. Lower this if the hosting plan caps function duration below it.
 */
export const maxDuration = 300;

const MAX_BODY_BYTES = 24 * 1024 * 1024;

interface ProviderChatBody extends ProviderInput {
  request?: ChatRequest;
}

export async function POST(request: Request): Promise<Response> {
  const gate = await guard(request, { bucket: 'provider-chat', limit: 60, windowMs: 60_000 });
  if (!gate.ok) return gate.response;

  let body: ProviderChatBody;
  try {
    body = await readJson<ProviderChatBody>(request, MAX_BODY_BYTES);
  } catch (error) {
    return (
      bodyErrorResponse(error) ??
      NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    );
  }

  try {
    return await providerChat(body, body.request as ChatRequest, request.signal);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Provider request failed.' },
      { status: error instanceof ProviderError ? error.status : 502 },
    );
  }
}
