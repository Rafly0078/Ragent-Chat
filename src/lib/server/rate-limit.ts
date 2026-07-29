import 'server-only';

/**
 * Dependency-free, in-memory rate limiter for the Route Handlers.
 *
 * Scope and limits: state lives in the module, so it is per-server-instance.
 * On a serverless host each cold instance starts with an empty window, which
 * means a determined attacker spread across instances gets a higher effective
 * ceiling than the numbers below suggest. That is an accepted trade-off — the
 * goal here is to stop the cheap cases (a loop hammering the open route, a
 * runaway client) from draining the Ollama box or the Tavily quota, without
 * adding a Redis/KV dependency. Swap `hit()` for a KV-backed counter if this
 * ever needs to be authoritative.
 */

interface Bucket {
  /** Request timestamps (ms) inside the current window. */
  hits: number[];
  /** Last time this bucket was touched — used to evict idle keys. */
  seen: number;
}

const buckets = new Map<string, Bucket>();

/** Drop buckets nobody has touched in a while so the Map can't grow forever. */
const IDLE_EVICT_MS = 10 * 60_000;
const MAX_KEYS = 5_000;

function evictStale(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.seen > IDLE_EVICT_MS) buckets.delete(key);
  }
  // Pathological case (huge key churn): drop the oldest half rather than
  // letting the Map grow without bound.
  if (buckets.size > MAX_KEYS) {
    const sorted = [...buckets.entries()].sort((a, b) => a[1].seen - b[1].seen);
    for (const [key] of sorted.slice(0, Math.floor(sorted.length / 2))) buckets.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the caller may retry (only meaningful when `ok` is false). */
  retryAfter: number;
  remaining: number;
}

/**
 * Sliding-window counter. Returns `ok: false` once `limit` requests have been
 * recorded for `key` within `windowMs`.
 */
export function hit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  if (buckets.size > 64) evictStale(now);

  const bucket = buckets.get(key) ?? { hits: [], seen: now };
  bucket.seen = now;
  // Drop timestamps that have aged out of the window.
  const cutoff = now - windowMs;
  bucket.hits = bucket.hits.filter((t) => t > cutoff);
  buckets.set(key, bucket);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0] ?? now;
    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
      remaining: 0,
    };
  }

  bucket.hits.push(now);
  return { ok: true, retryAfter: 0, remaining: limit - bucket.hits.length };
}

/**
 * Best-effort client identity for rate-limit keys. Prefers the authenticated
 * user id (stable, not shared by NAT) and falls back to the forwarded IP.
 */
export function clientKey(request: Request, userId?: string | null): string {
  if (userId) return `u:${userId}`;
  const forwarded = request.headers.get('x-forwarded-for');
  const ip =
    forwarded?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown';
  return `ip:${ip}`;
}

/** 429 response with a `Retry-After` header, ready to return from a handler. */
export function tooManyRequests(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({ error: 'Too many requests. Please slow down and try again.' }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(result.retryAfter),
      },
    },
  );
}
