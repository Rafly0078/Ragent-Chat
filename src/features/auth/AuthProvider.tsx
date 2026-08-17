'use client';

/**
 * Auth context. Exposes the current Supabase user/session and the sign-in
 * methods. When Supabase isn't configured, `enabled` is false and the app runs
 * in pure guest mode (localStorage persistence) with no auth UI required.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import { loadSupabaseBrowser } from '@/lib/supabase/client';
import { supabaseConfigured } from '@/lib/supabase/env';
import { useChatStore } from '@/lib/store/chat-store';
import { ensureProfile } from '@/lib/services/profile.service';
import type { Database } from '@/lib/supabase/types';

export type OAuthProvider = 'google' | 'github';

interface AuthContextValue {
  /** True when Supabase is configured — gates all auth features. */
  enabled: boolean;
  /** True until the first session check resolves. */
  loading: boolean;
  user: User | null;
  session: Session | null;
  /** Convenience: signed in and NOT an anonymous/guest user. */
  isAuthenticated: boolean;
  isGuest: boolean;
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithOtp: (email: string) => Promise<{ error: string | null }>;
  signInWithOAuth: (provider: OAuthProvider) => Promise<{ error: string | null }>;
  continueAsGuest: () => Promise<{ error: string | null }>;
  /** Signs out and clears the locally cached chats. */
  signOut: () => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Which non-anonymous account the locally cached chats belong to.
 *
 * Mirrored to localStorage because the identity can change while this tab isn't
 * running — a refresh token revoked by a password change, a sign-out in another tab
 * — and the store's persist key (`ollama-webui:chats`) is a single global one with
 * no user in it.
 */
const CHAT_OWNER_KEY = 'ollama-webui:chat-owner';

function readChatOwner(): string | null {
  try {
    return window.localStorage.getItem(CHAT_OWNER_KEY);
  } catch {
    return null;
  }
}

function writeChatOwner(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(CHAT_OWNER_KEY, id);
    else window.localStorage.removeItem(CHAT_OWNER_KEY);
  } catch {
    /* storage unavailable — the in-tab ref below still catches a live switch */
  }
}

/**
 * Drop the locally cached chats, on the way out of an account by any route.
 *
 * Only the explicit `signOut()` used to do this, so a session that ended any other
 * way left the previous user's conversations in `ollama-webui:chats`; the next
 * person to sign in on the same browser had them merged into — and uploaded to —
 * THEIR account. Cross-account disclosure plus permanent contamination.
 */
function clearCachedChats(): void {
  const clear = () => {
    try {
      useChatStore.persist.clearStorage();
    } catch {
      /* storage unavailable — the state reset below still applies */
    }
    useChatStore.setState({ conversations: [], activeId: null, generatingId: null });
  };
  clear();
  writeChatOwner(null);
  // The snapshot lives in IndexedDB, so hydration is a round trip that can still be
  // in flight here — on a cold load, a session read that resolves first would have
  // its clear undone moments later by the previous user's chats arriving.
  if (useChatStore.persist.hasHydrated()) return;
  const stop = useChatStore.persist.onFinishHydration(() => {
    stop();
    clear();
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const enabled = supabaseConfigured();
  const [loading, setLoading] = useState(enabled);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  // Populated by the mount effect, not at render time: creating the client
  // eagerly here is what pulled @supabase/ssr into the root bundle of every
  // route. Every consumer below already null-checks it, and AuthGate holds the
  // app behind `loading` until the first session read resolves, so nothing can
  // observe the brief null window.
  const supabaseRef = useRef<SupabaseClient<Database> | null>(null);
  // Track which user we've already backfilled a profile for, so onAuthStateChange
  // firing repeatedly (token refresh, tab focus) doesn't re-hit the DB each time.
  const ensuredFor = useRef<string | null>(null);
  /** The account the cached chats belong to, for this tab. Backed by localStorage. */
  const chatOwner = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    /**
     * The local chat cache belongs to one account, so drop it the moment the
     * authenticated identity moves off that account — a sign-out here, a sign-out in
     * another tab, a revoked token, or a different account signing in. Runs before
     * `setUser`, so the store is already empty when `useChatSync` re-runs for the new
     * id and cannot push the previous user's chats into the new user's rows.
     *
     * Only a non-anonymous id is ever recorded as the owner, which is what keeps the
     * deliberate guest → account migration working: a guest never owned the cache, so
     * its chats still merge upward on sign-in.
     */
    const noteIdentity = (next: User | null) => {
      const owner = chatOwner.current ?? readChatOwner();
      if (owner && next?.id !== owner) {
        clearCachedChats();
        chatOwner.current = null;
      }
      if (next && !next.is_anonymous) {
        chatOwner.current = next.id;
        writeChatOwner(next.id);
      }
    };

    // Self-heal a missing profile row on sign-in (see ensureProfile). Fire and
    // forget — never block auth on it, and swallow errors so a transient DB
    // hiccup can't wedge the login flow.
    const maybeEnsureProfile = (u: User | null) => {
      if (!u || u.is_anonymous || ensuredFor.current === u.id) return;
      ensuredFor.current = u.id;
      void ensureProfile(u).catch(() => {
        ensuredFor.current = null; // allow a retry on the next auth event
      });
    };

    let active = true;
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      const supabase = await loadSupabaseBrowser();
      // `enabled` was true, so a null here means the config went away mid-flight
      // — nothing to subscribe to, but the gate must still be released or the
      // app sits on the spinner forever.
      if (!supabase || !active) {
        if (active) setLoading(false);
        return;
      }
      supabaseRef.current = supabase;

      const { data } = await supabase.auth.getSession();
      if (!active) return;
      noteIdentity(data.session?.user ?? null);
      setSession(data.session);
      setUser(data.session?.user ?? null);
      maybeEnsureProfile(data.session?.user ?? null);
      setLoading(false);

      const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
        noteIdentity(next?.user ?? null);
        setSession(next);
        setUser(next?.user ?? null);
        maybeEnsureProfile(next?.user ?? null);
        setLoading(false);
      });
      unsubscribe = () => sub.subscription.unsubscribe();
      // A listener registered after the effect was torn down would leak.
      if (!active) unsubscribe();
    })();

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [enabled]);

  const redirectTo = useCallback(() => {
    if (typeof window === 'undefined') return undefined;
    return `${window.location.origin}/auth/callback`;
  }, []);

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const supabase = supabaseRef.current;
    if (!supabase) return { error: 'Auth is not configured.' };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signUpWithPassword = useCallback(
    async (email: string, password: string) => {
      const supabase = supabaseRef.current;
      if (!supabase) return { error: 'Auth is not configured.' };
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo() },
      });
      return { error: error?.message ?? null };
    },
    [redirectTo],
  );

  const signInWithOtp = useCallback(
    async (email: string) => {
      const supabase = supabaseRef.current;
      if (!supabase) return { error: 'Auth is not configured.' };
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo() },
      });
      return { error: error?.message ?? null };
    },
    [redirectTo],
  );

  const signInWithOAuth = useCallback(
    async (provider: OAuthProvider) => {
      const supabase = supabaseRef.current;
      if (!supabase) return { error: 'Auth is not configured.' };
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: redirectTo() },
      });
      return { error: error?.message ?? null };
    },
    [redirectTo],
  );

  const continueAsGuest = useCallback(async () => {
    const supabase = supabaseRef.current;
    if (!supabase) return { error: 'Auth is not configured.' };
    const { error } = await supabase.auth.signInAnonymously();
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async () => {
    const supabase = supabaseRef.current;
    if (!supabase) return { error: 'Auth is not configured.' };
    const { error } = await supabase.auth.signOut();
    // Runs even if signOut errored, since the intent to leave is explicit. The auth
    // event does this too, via `noteIdentity` — this is the one path that must not
    // depend on the event arriving.
    clearCachedChats();
    chatOwner.current = null;
    return { error: error?.message ?? null };
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const isGuest = Boolean(user?.is_anonymous);
    return {
      enabled,
      loading,
      user,
      session,
      isAuthenticated: Boolean(user) && !isGuest,
      isGuest,
      signInWithPassword,
      signUpWithPassword,
      signInWithOtp,
      signInWithOAuth,
      continueAsGuest,
      signOut,
    };
  }, [
    enabled,
    loading,
    user,
    session,
    signInWithPassword,
    signUpWithPassword,
    signInWithOtp,
    signInWithOAuth,
    continueAsGuest,
    signOut,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>.');
  return ctx;
}
