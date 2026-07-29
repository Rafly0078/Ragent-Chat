import 'server-only';

/**
 * Size-capped JSON body reader for Route Handlers.
 *
 * `await request.json()` buffers whatever the client sends with no ceiling, so a
 * single large POST could pin a serverless instance's memory. This rejects on
 * the declared Content-Length when present, and enforces the real limit while
 * streaming for chunked/unknown-length requests.
 */

export class BodyError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'BodyError';
    this.status = status;
  }
}

export async function readJson<T>(request: Request, maxBytes: number): Promise<T> {
  const declared = Number(request.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BodyError('Request body is too large.', 413);
  }

  const reader = request.body?.getReader();
  if (!reader) throw new BodyError('Missing request body.', 400);

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new BodyError('Request body is too large.', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const text = new TextDecoder().decode(merged);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new BodyError('Invalid JSON body.', 400);
  }
}

/** Turn a thrown BodyError into its response; rethrow anything else. */
export function bodyErrorResponse(err: unknown): Response | null {
  if (err instanceof BodyError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  return null;
}
