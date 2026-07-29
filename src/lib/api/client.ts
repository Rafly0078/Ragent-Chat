import type { ModelInfo } from '@/types';
import { ApiError, DEFAULT_TIMEOUT_MS, STREAM_IDLE_TIMEOUT_MS, apiUrl } from './config';
import { parseChatStream } from './stream';
import type {
  ChatRequest,
  ChatStreamChunk,
  ModelsResponse,
  RawModel,
} from './types';

/**
 * Direct mode sends these from the BROWSER straight to Ollama. Any custom header
 * (like ngrok's `ngrok-skip-browser-warning`) triggers a CORS preflight the
 * upstream must explicitly allow in `Access-Control-Allow-Headers`; most Ollama /
 * Cloudflare Tunnel setups don't, so the request gets blocked. Keeping this empty
 * avoids the preflight entirely. ngrok users who need the skip header should use
 * bridge mode, where the header is added server-side (see lib/bridge/ollama.ts)
 * and no CORS applies.
 */
const TUNNEL_HEADERS = {} as const;

/** Combine an external signal with an internal timeout. */
function withTimeout(ms: number, external?: AbortSignal): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), ms);
  const onAbort = () => ctrl.abort(external?.reason);
  if (external) {
    if (external.aborted) ctrl.abort(external.reason);
    else external.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    cancel: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    },
  };
}

async function assertOk(res: Response): Promise<void> {
  if (res.ok) return;
  let detail = res.statusText;
  try {
    const text = await res.text();
    if (text) {
      try {
        const j = JSON.parse(text) as { error?: string };
        detail = j.error ?? text;
      } catch {
        detail = text;
      }
    }
  } catch {
    /* ignore */
  }
  throw new ApiError(detail, { kind: 'http', status: res.status });
}

function mapModel(raw: RawModel): ModelInfo {
  const name = raw.name ?? raw.model ?? 'unknown';
  const d = raw.details ?? {};
  const caps = raw.capabilities ?? [];
  return {
    name,
    label: name.replace(/:latest$/, ''),
    size: raw.size,
    contextLength: raw.context_length,
    details: {
      family: d.family ?? d.families?.[0],
      parameterSize: d.parameter_size,
      quantizationLevel: d.quantization_level,
      format: d.format,
    },
    supportsVision:
      caps.includes('vision') ||
      /vision|llava|bakllava|moondream|llama3\.2-vision/i.test(name),
  };
}

/**
 * The browser talks directly to the Ollama-compatible endpoint configured via
 * NEXT_PUBLIC_API_URL / the Settings override — no server-side proxy, so long
 * chat generations aren't bound by a Vercel function's execution time limit.
 */
const API_TAG_PATHS = ['/api/tags', '/api/models'];
const API_CHAT_PATHS = ['/api/chat', '/api/chat/stream'];

async function fetchWithFallback(
  paths: string[],
  init: RequestInit,
): Promise<{ res: Response; usedPath: string }> {
  let lastError: unknown = null;

  for (const path of paths) {
    try {
      const res = await fetch(apiUrl(path), init);
      if (res.ok) return { res, usedPath: path };
      if (res.status === 404 || res.status === 405) {
        lastError = new ApiError(`Endpoint ${path} returned ${res.status}.`, {
          kind: 'http',
          status: res.status,
        });
        continue;
      }
      return { res, usedPath: path };
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new ApiError('Unable to reach any API route.', { kind: 'network' });
}

export async function fetchModels(signal?: AbortSignal): Promise<ModelInfo[]> {
  const { signal: s, cancel } = withTimeout(DEFAULT_TIMEOUT_MS, signal);
  try {
    const { res } = await fetchWithFallback(API_TAG_PATHS, {
      method: 'GET',
      headers: { Accept: 'application/json', ...TUNNEL_HEADERS },
      signal: s,
    });
    await assertOk(res);
    const data = (await res.json()) as ModelsResponse | RawModel[];
    const list = Array.isArray(data) ? data : data.models ?? [];
    return list.map(mapModel).sort((a, b) => a.label.localeCompare(b.label));
  } catch (err) {
    throw normalize(err);
  } finally {
    cancel();
  }
}

export interface StreamHandlers {
  onDelta: (text: string) => void;
  /** Reasoning deltas from the model's `thinking` stream, if any. */
  onThinking?: (text: string) => void;
  onDone: (final: ChatStreamChunk) => void;
}

/**
 * POST /api/chat/stream — stream a chat completion.
 * Returns when the stream ends or is aborted. Deltas are pushed via handlers.
 *
 * There is deliberately no overall deadline (a long generation is normal), but
 * there IS an idle watchdog: if the upstream stops sending for
 * STREAM_IDLE_TIMEOUT_MS the request is aborted and surfaced as a timeout.
 * Without it, a tunnel that dies mid-response left the UI "generating" forever
 * with no error and no way out but the stop button.
 */
export async function streamChat(
  req: ChatRequest,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const idle = new AbortController();
  const onExternalAbort = () => idle.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) idle.abort(signal.reason);
    else signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let idleFired = false;
  const armIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleFired = true;
      idle.abort(new DOMException('stream idle timeout', 'TimeoutError'));
    }, STREAM_IDLE_TIMEOUT_MS);
  };
  const cleanup = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    signal?.removeEventListener('abort', onExternalAbort);
  };

  try {
    let res: Response;
    try {
      armIdleTimer();
      const result = await fetchWithFallback(API_CHAT_PATHS, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson, text/event-stream',
          ...TUNNEL_HEADERS,
        },
        body: JSON.stringify({ ...req, stream: true }),
        signal: idle.signal,
      });
      res = result.res;
    } catch (err) {
      throw normalize(err);
    }

    await assertOk(res);
    if (!res.body) throw new ApiError('The server did not return a stream body.', { kind: 'parse' });

    let final: ChatStreamChunk = {};
    try {
      for await (const chunk of parseChatStream(res.body, idle.signal)) {
        armIdleTimer();
        if (chunk.error) throw new ApiError(chunk.error, { kind: 'http', status: res.status });
        const thinking = chunk.message?.thinking ?? '';
        if (thinking) handlers.onThinking?.(thinking);
        const delta = chunk.message?.content ?? chunk.response ?? '';
        if (delta) handlers.onDelta(delta);
        if (chunk.done) final = { ...final, ...chunk };
      }
    } catch (err) {
      throw normalize(err);
    }
    // `parseChatStream` exits cleanly when its signal is already aborted, so an
    // idle abort can look like a normal end-of-stream. Surface it as a timeout
    // instead of silently marking a truncated answer complete.
    if (idleFired) {
      throw new ApiError('The connection stalled — no data for 2 minutes.', { kind: 'timeout' });
    }
    handlers.onDone(final);
  } finally {
    cleanup();
  }
}

/**
 * POST /api/chat — non-streaming completion. Used for auto-title generation,
 * context compaction and search planning; those run on the same local model as
 * the chat itself, so callers can raise the deadline (`timeoutMs`) when the work
 * is inherently slow (summarizing a long transcript).
 */
export async function chat(
  req: ChatRequest,
  signal?: AbortSignal,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const { signal: s, cancel } = withTimeout(timeoutMs, signal);
  try {
    const { res } = await fetchWithFallback(API_CHAT_PATHS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...TUNNEL_HEADERS },
      body: JSON.stringify({ ...req, stream: false }),
      signal: s,
    });
    await assertOk(res);
    const data = (await res.json()) as ChatStreamChunk;
    return data.message?.content ?? data.response ?? '';
  } catch (err) {
    throw normalize(err);
  } finally {
    cancel();
  }
}

/** Lightweight connectivity probe for the status indicator. */
export async function ping(signal?: AbortSignal): Promise<boolean> {
  const { signal: s, cancel } = withTimeout(8000, signal);
  try {
    const { res } = await fetchWithFallback(API_TAG_PATHS, {
      method: 'GET',
      headers: { ...TUNNEL_HEADERS },
      signal: s,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    cancel();
  }
}

function normalize(err: unknown): ApiError {
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return new ApiError('The request timed out.', { kind: 'timeout' });
  }
  return ApiError.from(err);
}
