'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Github, Loader2, Mail } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useAuth, type OAuthProvider } from './AuthProvider';

type Mode = 'signin' | 'signup' | 'magic';

/**
 * Sign-in / sign-up dialog. Email password, magic link, OAuth, and guest.
 *
 * Pass `mandatory` when this is gating the whole app (see `AuthGate`): it
 * hides the "Continue as guest" bypass and makes the dialog undismissable
 * (no X, no Escape, no backdrop click) since the person must actually sign
 * in to proceed.
 */
export function AuthDialog({
  open,
  onClose,
  mandatory = false,
}: {
  open: boolean;
  onClose: () => void;
  mandatory?: boolean;
}) {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reset = () => {
    setError(null);
    setNotice(null);
  };

  /**
   * Map a provider error to user-facing copy.
   *
   * Supabase's raw messages were rendered verbatim, which turned the dialog into
   * an account-existence oracle for any email address ("User already
   * registered") and leaked rate-limit timings. Network/config problems still
   * pass through, since those are actionable.
   */
  const friendlyError = (raw: string): string => {
    const m = raw.toLowerCase();
    if (m.includes('already registered') || m.includes('already exists')) {
      // Deliberately identical to the success path's copy — see submit().
      return '';
    }
    if (m.includes('invalid login') || m.includes('invalid credentials')) {
      return 'Invalid email or password.';
    }
    if (m.includes('email not confirmed')) {
      return 'Confirm your email address first — check your inbox for the link.';
    }
    if (m.includes('rate limit') || m.includes('after') || m.includes('too many')) {
      return 'Too many attempts. Please wait a minute and try again.';
    }
    if (m.includes('password')) return 'That password does not meet the requirements.';
    if (m.includes('fetch') || m.includes('network')) return raw;
    return 'Something went wrong. Please try again.';
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    reset();
    setBusy('email');
    try {
      if (mode === 'magic') {
        const { error } = await auth.signInWithOtp(email);
        // Always the same response, whether or not the address has an account.
        if (error) {
          const friendly = friendlyError(error);
          if (friendly) setError(friendly);
          else setNotice('Check your email for a sign-in link.');
        } else setNotice('Check your email for a sign-in link.');
      } else if (mode === 'signup') {
        const { error } = await auth.signUpWithPassword(email, password);
        if (error) {
          const friendly = friendlyError(error);
          if (friendly) setError(friendly);
          else setNotice('Check your email to confirm your account, then sign in.');
        } else setNotice('Account created. Check your email to confirm, then sign in.');
      } else {
        const { error } = await auth.signInWithPassword(email, password);
        if (error) setError(friendlyError(error) || 'Invalid email or password.');
        else onClose();
      }
    } finally {
      setBusy(null);
    }
  }

  async function oauth(provider: OAuthProvider) {
    reset();
    setBusy(provider);
    const { error } = await auth.signInWithOAuth(provider);
    if (error) {
      setError(friendlyError(error) || 'Sign-in failed. Please try again.');
      setBusy(null);
    }
    // On success the browser redirects; no need to clear busy.
  }

  async function guest() {
    reset();
    setBusy('guest');
    const { error } = await auth.continueAsGuest();
    if (error) setError(friendlyError(error) || 'Could not start a guest session.');
    else onClose();
    setBusy(null);
  }

  const title =
    mode === 'signup' ? 'Create account' : mode === 'magic' ? 'Email sign-in link' : 'Sign in';
  const description = mandatory
    ? 'Sign in to use Ragent — an account is required.'
    : 'Sync your workspace across devices.';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      dismissible={!mandatory}
    >
      <div className="flex flex-col gap-4">
        {/* OAuth */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant="surface"
            onClick={() => oauth('google')}
            disabled={Boolean(busy)}
          >
            {busy === 'google' ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleGlyph />}
            <span className="ml-2">Google</span>
          </Button>
          <Button
            type="button"
            variant="surface"
            onClick={() => oauth('github')}
            disabled={Boolean(busy)}
          >
            {busy === 'github' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Github className="h-4 w-4" />
            )}
            <span className="ml-2">GitHub</span>
          </Button>
        </div>

        <div className="flex items-center gap-3 text-xs text-content/50">
          <span className="h-px flex-1 bg-border/30" />
          or
          <span className="h-px flex-1 bg-border/30" />
        </div>

        {/* Email form */}
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            className="input"
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
          />
          {mode !== 'magic' && (
            <input
              className="input"
              type="password"
              required
              placeholder={mode === 'signup' ? 'Password (at least 8 characters)' : 'Password'}
              value={password}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              minLength={mode === 'signup' ? 8 : 6}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}

          {error && (
            <p className="text-sm text-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="text-sm text-content/70" role="status">
              {notice}
            </p>
          )}

          <Button type="submit" variant="primary" disabled={Boolean(busy)}>
            {busy === 'email' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Mail className="h-4 w-4" />
            )}
            <span className="ml-2">
              {mode === 'signup' ? 'Create account' : mode === 'magic' ? 'Send link' : 'Sign in'}
            </span>
          </Button>
        </form>

        {/* Mode switches */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-content/60">
          <div className="flex gap-3">
            {mode !== 'signin' && (
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setMode('signin');
                  reset();
                }}
              >
                Sign in
              </button>
            )}
            {mode !== 'signup' && (
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setMode('signup');
                  reset();
                }}
              >
                Create account
              </button>
            )}
            {mode !== 'magic' && (
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setMode('magic');
                  reset();
                }}
              >
                Email link
              </button>
            )}
          </div>
          {!mandatory && (
            <button type="button" className="underline" onClick={guest} disabled={Boolean(busy)}>
              {busy === 'guest' ? 'Starting…' : 'Continue as guest'}
            </button>
          )}
          {/* Always leave a way out of the mandatory wall. It has no X, no
              Escape and no backdrop click by design, which was fine when there
              was nowhere else to be — but `/` is a public page now, so without
              this the wall traps you on /chat with no route back. */}
          {mandatory && (
            <Link href="/" className="focus-ring underline">
              Back to home
            </Link>
          )}
        </div>
      </div>
    </Modal>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M21.35 11.1H12v3.2h5.35c-.23 1.5-1.6 4.4-5.35 4.4-3.2 0-5.8-2.65-5.8-5.9s2.6-5.9 5.8-5.9c1.82 0 3.05.78 3.75 1.45l2.55-2.45C16.9 3.95 14.7 3 12 3 6.98 3 3 6.98 3 12s3.98 9 9 9c5.2 0 8.64-3.65 8.64-8.8 0-.6-.06-1.05-.29-2.1z"
      />
    </svg>
  );
}
