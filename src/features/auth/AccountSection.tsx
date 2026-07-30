'use client';

import { useState } from 'react';
import { m } from 'framer-motion';
import { LogIn, LogOut, User as UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useAuth } from './AuthProvider';
import { AuthDialog } from './AuthDialog';
import { userLabel } from '@/lib/services/profile.service';

/** Account panel for the settings page. Sign-in state, provider, sign-out. */
export function AccountSection() {
  const auth = useAuth();
  const { toast } = useToast();
  const [dialog, setDialog] = useState(false);

  return (
    <m.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass mb-6 rounded-3xl p-5 shadow-card sm:p-6"
    >
      <div className="mb-4 flex items-center gap-2">
        <UserIcon className="h-5 w-5 text-accent" />
        <h2 className="text-lg font-semibold tracking-tight text-content">Account</h2>
      </div>

      {!auth.enabled ? (
        <p className="text-sm text-content-muted">
          Sign-in is not configured. The app runs local-only; conversations stay in this browser.
          Add <code className="text-accent-soft">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
          <code className="text-accent-soft">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to enable sync.
        </p>
      ) : auth.loading ? (
        <p className="text-sm text-content-muted">Checking session…</p>
      ) : auth.user ? (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-content">{userLabel(auth.user)}</p>
            <p className="text-xs text-content-muted">
              {auth.isGuest ? 'Guest session — conversations sync while signed in.' : auth.user.email}
            </p>
          </div>
          <div className="flex gap-2">
            {auth.isGuest && (
              <Button variant="primary" onClick={() => setDialog(true)}>
                <LogIn className="h-4 w-4" /> <span className="ml-1.5">Sign in</span>
              </Button>
            )}
            <Button
              variant="surface"
              onClick={() => {
                // A failed sign-out used to be invisible: no auth event fires, the
                // session stays valid, and the user believes they've signed out —
                // on a shared machine that matters.
                void auth.signOut().then(({ error }) => {
                  if (error) toast(`Could not sign out: ${error}`, 'error');
                });
              }}
            >
              <LogOut className="h-4 w-4" /> <span className="ml-1.5">Sign out</span>
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-content-muted">
            Sign in to sync conversations across devices, or continue as a guest.
          </p>
          <Button variant="primary" onClick={() => setDialog(true)}>
            <LogIn className="h-4 w-4" /> <span className="ml-1.5">Sign in</span>
          </Button>
        </div>
      )}

      <AuthDialog open={dialog} onClose={() => setDialog(false)} />
    </m.section>
  );
}
