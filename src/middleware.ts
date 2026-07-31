import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

/** Keep the Supabase session fresh on navigations and API calls. */
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Run on everything except static assets and image optimization.
  matcher: [
    '/((?!_next/static|_next/image|favicon.svg|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg)$).*)',
  ],
};
