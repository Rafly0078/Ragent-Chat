import 'server-only';

import { BridgeError, getBridgeTarget } from './config';

/**
 * Thin server-side fetchers against the Ollama-compatible upstream. Endpoint
 * fallbacks mirror the previous client so no upstream behavior changes.
 */

const TAG_PATHS = ['/api/tags', '/api/models'];
const CHAT_PATHS = ['/api/chat', '/api/chat/stream'];
const SHOW_PATHS = ['/api/show'];

/**
 * How long to wait for the upstream to *respond with headers*. Deliberately not
 * a whole-request timeout: a chat generation streams for minutes and must not be
 * cut off. `fetch` resolves as soon as headers arrive, so the timer is cleared
 * before the body is read. Without this, an unreachable-but-not-refusing
 * upstream (a dead tunnel that black-holes packets) hung the route until the
 * platform killed it, and the user saw a spinner with no error.
 */
const CONNECT_TIMEOUT_MS = 20_000;

/**
 * Sent on every upstream request. ngrok's free tier serves an HTML browser-
 * warning interstitial for requests without this header; that HTML then arrives
 * where the client expects JSON/NDJSON. Cloudflare Tunnels and a bare Ollama
 * server ignore the unknown header, so it's safe to send unconditionally.
 */
const TUNNEL_HEADERS = { 'ngrok-skip-browser-warning': 'true' } as const;

function url(path: string): string {
  const base = getBridgeTarget();
  if (!base) throw new BridgeError('Ollama target not configured on the server.', 500);
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Fetch with a connect (time-to-headers) deadline, chained to the caller's
 * abort signal so a client disconnect still tears the upstream request down.
 */
async function fetchWithConnectTimeout(
  target: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(
    () => controller.abort(new DOMException('Upstream connect timeout', 'TimeoutError')),
    CONNECT_TIMEOUT_MS,
  );

  try {
    return await fetch(target, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new BridgeError('The Ollama server did not respond in time.', 504);
    }
    throw err;
  } finally {
    // Stop the clock once headers are in — the body may stream for minutes.
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Try each candidate path until one responds without 404/405. */
async function fetchFallback(
  paths: string[],
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  const merged: RequestInit = { ...init, headers: { ...TUNNEL_HEADERS, ...init.headers } };
  let last: Response | null = null;
  for (const p of paths) {
    const res = await fetchWithConnectTimeout(url(p), merged, signal);
    if (res.ok) return res;
    if (res.status === 404 || res.status === 405) {
      // Drain the discarded body so the connection can be reused instead of
      // being held open until GC.
      await res.body?.cancel().catch(() => {});
      last = res;
      continue;
    }
    return res;
  }
  if (last) return last;
  throw new BridgeError('Unable to reach any upstream route.');
}

export function upstreamModels(signal?: AbortSignal): Promise<Response> {
  return fetchFallback(TAG_PATHS, { method: 'GET', headers: { Accept: 'application/json' } }, signal);
}

export function upstreamShow(name: string, signal?: AbortSignal): Promise<Response> {
  return fetchFallback(
    SHOW_PATHS,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, model: name }),
    },
    signal,
  );
}

export function upstreamChat(body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetchFallback(
    CHAT_PATHS,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson, text/event-stream',
      },
      body: JSON.stringify(body),
    },
    signal,
  );
}
