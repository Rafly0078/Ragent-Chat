'use client';

import { usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { AuthDialog } from './AuthDialog';

/**
 * Routes that are public by design. The landing page is a marketing surface —
 * putting the mandatory sign-in dialog over it would hide the very thing a
 * first-time visitor came to read (and its 70% black backdrop dims the whole
 * blue field).
 */
const PUBLIC_PATHS = new Set(['/']);

/**
 * App-wide login wall. Renders the app underneath as usual, but pops a
 * mandatory sign-in dialog on top whenever Supabase is configured and there
 * is no authenticated user — guest sessions included, since the whole point
 * is that every real visitor has to sign in. The dialog can't be dismissed;
 * it disappears on its own the moment `isAuthenticated` flips true.
 *
 * No-ops entirely when Supabase isn't configured (`auth.enabled === false`),
 * so local/dev deployments without env vars keep working guest-only.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const pathname = usePathname();
  const isPublic = PUBLIC_PATHS.has(pathname);

  // First session check on load — avoid flashing the sign-in popup (or the
  // app) before we actually know whether there's a valid session. Public pages
  // render immediately; they don't depend on the session at all.
  if (auth.enabled && auth.loading && !isPublic) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-surface">
        <Loader2
          className="h-6 w-6 animate-spin text-content-subtle"
          aria-label="Checking session"
        />
      </div>
    );
  }

  const requireSignIn = auth.enabled && !auth.isAuthenticated && !isPublic;

  return (
    <>
      {children}
      <AuthDialog open={requireSignIn} onClose={() => {}} mandatory />
    </>
  );
}
