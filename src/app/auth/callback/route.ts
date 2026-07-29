import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Only same-origin, path-relative destinations are accepted. `next` arrives
 * from a URL an attacker can hand to the user, and it used to be concatenated
 * straight onto the origin — a value like `https://evil.example` produced a
 * malformed URL that made `NextResponse.redirect` throw (a 500 instead of a
 * sign-in), and protocol-relative forms are the classic open-redirect shape.
 */
function safeNext(raw: string | null): string {
  if (!raw) return '/';
  // Must be a single-slash absolute path: rejects "//host", "/\\host",
  // "https://host" and anything with a scheme or backslash trickery.
  if (!/^\/(?![/\\])[^\\]*$/.test(raw)) return '/';
  return raw;
}

/**
 * OAuth / magic-link callback. Exchanges the `code` for a session (PKCE) and
 * redirects to `next` (default: home). Cookies are set via the server client.
 */
export async function GET(request: Request): Promise<Response> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeNext(searchParams.get('next'));

  if (code) {
    const supabase = await getSupabaseServer();
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(`${origin}${next}`);
      return NextResponse.redirect(`${origin}/?auth_error=${encodeURIComponent(error.message)}`);
    }
    return NextResponse.redirect(`${origin}/?auth_error=auth_not_configured`);
  }

  return NextResponse.redirect(`${origin}/?auth_error=missing_code`);
}
