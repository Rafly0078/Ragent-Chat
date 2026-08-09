import 'server-only';

import crypto from 'node:crypto';

/** Authenticate requests to the public API using a Vercel server-only secret. */
export function publicApiConfigured(): boolean {
  return Boolean(process.env.RAGENT_API_KEY?.trim());
}

export function publicApiAuthorized(request: Request): boolean {
  const expected = process.env.RAGENT_API_KEY?.trim();
  if (!expected) return false;

  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const supplied = bearer?.trim() || request.headers.get('x-api-key')?.trim() || '';
  const digest = (value: string) => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(digest(expected), digest(supplied));
}

export function publicApiUnauthorized(): Response {
  return Response.json(
    { error: { message: 'Invalid or missing API key.', type: 'authentication_error' } },
    {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer', 'Cache-Control': 'no-store' },
    },
  );
}
