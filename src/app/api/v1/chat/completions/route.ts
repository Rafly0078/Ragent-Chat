import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { bodyErrorResponse, readJson } from '@/lib/server/body';
import { clientKey, hit, tooManyRequests } from '@/lib/server/rate-limit';
import {
  publicApiAuthorized,
  publicApiConfigured,
  publicApiUnauthorized,
} from '@/lib/api/public-auth';
import { BridgeError, bridgeConfigured } from '@/lib/bridge/config';
import { upstreamChat } from '@/lib/bridge/ollama';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 24 * 1024 * 1024;

type OpenAIMessage = { role: 'system' | 'user' | 'assistant'; content?: unknown };
type OpenAIRequest = {
  model?: unknown;
  messages?: unknown;
  stream?: unknown;
  temperature?: unknown;
  top_p?: unknown;
  max_tokens?: unknown;
  max_completion_tokens?: unknown;
};

class PublicRequestError extends Error {}

function textContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const item = part as { type?: unknown; text?: unknown };
      return item.type === 'text' && typeof item.text === 'string' ? item.text : '';
    })
    .join('');
}

function toOllamaBody(input: OpenAIRequest): Record<string, unknown> {
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  if (!model || !Array.isArray(input.messages) || input.messages.length === 0) {
    throw new PublicRequestError('`model` and non-empty `messages` are required.');
  }
  const messages = (input.messages as OpenAIMessage[]).map((message) => ({
    role: message.role,
    content: textContent(message.content),
  }));
  const maxTokens = input.max_completion_tokens ?? input.max_tokens;
  const options = Object.fromEntries(
    Object.entries({ temperature: input.temperature, top_p: input.top_p, num_predict: maxTokens }).filter(
      ([, value]) => typeof value === 'number',
    ),
  );
  return {
    model,
    messages,
    stream: input.stream === true,
    ...(Object.keys(options).length ? { options } : {}),
  };
}

function openAIResponse(body: Record<string, unknown>, model: string): Record<string, unknown> {
  const message = (body.message ?? {}) as { content?: unknown; thinking?: unknown };
  return {
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: (body.model as string) || model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: textContent(message.content) },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: body.prompt_eval_count ?? 0,
      completion_tokens: body.eval_count ?? 0,
      total_tokens: Number(body.prompt_eval_count ?? 0) + Number(body.eval_count ?? 0),
    },
  };
}

function streamAsOpenAI(body: ReadableStream<Uint8Array>, model: string): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const id = `chatcmpl-${crypto.randomUUID()}`;
  return new ReadableStream({
    async start(controller) {
      let buffer = '';
      const emit = (chunk: Record<string, unknown> | '[DONE]') =>
        controller.enqueue(encoder.encode(`data: ${chunk === '[DONE]' ? '[DONE]' : JSON.stringify(chunk)}\n\n`));
      const handle = (line: string) => {
        if (!line.trim()) return;
        try {
          const data = JSON.parse(line) as Record<string, unknown>;
          if (data.error) {
            emit({ error: { message: String(data.error), type: 'upstream_error' } });
            emit('[DONE]');
            return;
          }
          const message = (data.message ?? {}) as { content?: unknown };
          const content = textContent(message.content);
          if (content) emit({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: (data.model as string) || model, choices: [{ index: 0, delta: { content }, finish_reason: null }] });
          if (data.done === true) {
            emit({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
            emit('[DONE]');
          }
        } catch {
          // Ignore malformed upstream lines.
        }
      };
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? '';
          lines.forEach(handle);
        }
        if (buffer.trim()) handle(buffer);
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!publicApiConfigured()) return NextResponse.json({ error: { message: 'Public API is not configured.' } }, { status: 503 });
  const rate = hit(`public-api-chat:${clientKey(request)}`, 60, 60_000);
  if (!rate.ok) return tooManyRequests(rate);
  if (!publicApiAuthorized(request)) return publicApiUnauthorized();
  if (!bridgeConfigured()) return NextResponse.json({ error: { message: 'Model backend is not configured.' } }, { status: 503 });

  let input: OpenAIRequest;
  try {
    input = await readJson<OpenAIRequest>(request, MAX_BODY_BYTES);
  } catch (error) {
    return bodyErrorResponse(error) ?? NextResponse.json({ error: { message: 'Invalid JSON body.' } }, { status: 400 });
  }

  try {
    const body = toOllamaBody(input);
    const upstream = await upstreamChat(body, request.signal);
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '');
      return NextResponse.json({ error: { message: text || 'Model backend request failed.' } }, { status: upstream.status || 502 });
    }
    const model = body.model as string;
    if (body.stream === true) {
      return new Response(streamAsOpenAI(upstream.body, model), {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
      });
    }
    return NextResponse.json(openAIResponse((await upstream.json()) as Record<string, unknown>, model), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof PublicRequestError ? 400 : error instanceof BridgeError ? error.status : 502;
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : 'Request failed.' } }, { status });
  }
}
