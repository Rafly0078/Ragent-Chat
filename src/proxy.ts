import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

/** Keep the Supabase session fresh on navigations and API calls. */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Run on navigations only.
  //
  // `/api/` is excluded deliberately: the matcher used to cover it, so every
  // `POST /api/providers/chat` — the streamed chat request the user is actively
  // waiting on — paid a Supabase session-refresh round trip before the handler
  // even started. Same for /api/search. On mobile RTT that latency landed
  // exactly where it hurts most. The API routes authenticate themselves via
  // guard(), which reads the session server-side; they never needed the cookie
  // refresh this proxy performs.
  matcher: [
    '/((?!api/|_next/static|_next/image|favicon.svg|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg)$).*)',
  ],
};
