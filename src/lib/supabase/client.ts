'use client';

/**
 * Browser Supabase client (singleton). Uses the anon key and the user's
 * cookie-backed session. Returns null when Supabase isn't configured so the
 * app can run in pure guest/localStorage mode without crashing.
 *
 * `@supabase/ssr` + `@supabase/supabase-js` is 231 KB raw / 62 KB gzip, and a
 * static import here put it in the root chunk of every route — the marketing
 * landing page and the 404 page both downloaded the full auth client before
 * they could paint, despite neither touching a session. The dynamic import
 * below is the lazy boundary: it moves that weight into an async chunk fetched
 * on mount, after first paint, only where a session is actually read.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseConfigured } from './env';

let cached: SupabaseClient<Database> | null = null;
let inflight: Promise<SupabaseClient<Database> | null> | null = null;

/**
 * Load (once) and return the browser client. Every caller is already async, so
 * awaiting costs nothing after the first call — `cached` short-circuits it.
 */
export function loadSupabaseBrowser(): Promise<SupabaseClient<Database> | null> {
  if (cached) return Promise.resolve(cached);
  if (!supabaseConfigured()) return Promise.resolve(null);
  inflight ??= import('@supabase/ssr').then(({ createBrowserClient }) => {
    cached = createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
    return cached;
  });
  return inflight;
}

/**
 * Synchronous accessor for the already-loaded client. Non-null only once
 * `loadSupabaseBrowser()` has resolved at least once — use it where you know
 * that has happened (i.e. after AuthProvider mounted) and awaiting would be
 * awkward. Prefer `loadSupabaseBrowser()` everywhere else.
 */
export function getSupabaseBrowser(): SupabaseClient<Database> | null {
  return cached;
}
