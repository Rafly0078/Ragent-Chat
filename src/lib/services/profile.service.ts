'use client';

/** Profile + preferences persistence for the signed-in user. */

import type { User } from '@supabase/supabase-js';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import type { ProfileRow } from '@/lib/supabase/types';

export async function getProfile(): Promise<ProfileRow | null> {
  const supabase = getSupabaseBrowser();
  if (!supabase) return null;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', auth.user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Guarantee a profile row exists for the signed-in user, creating it from the
 * auth metadata if missing. The DB trigger (handle_new_user) only fires once,
 * on the initial auth.users INSERT — so if a profile row is ever deleted, a
 * later sign-in reuses the same auth.users row and never re-triggers it,
 * leaving the user with no profile. Calling this on every sign-in makes the
 * app self-heal instead of depending solely on that one-shot trigger.
 * Guests (anonymous users) are skipped.
 */
export async function ensureProfile(user: User): Promise<void> {
  const supabase = getSupabaseBrowser();
  if (!supabase || user.is_anonymous) return;

  const meta = user.user_metadata as
    | { full_name?: string; name?: string; avatar_url?: string; picture?: string }
    | undefined;

  const { error } = await supabase.from('profiles').upsert(
    {
      id: user.id,
      email: user.email ?? null,
      display_name: meta?.full_name || meta?.name || null,
      avatar_url: meta?.avatar_url || meta?.picture || null,
      is_guest: false,
    },
    // Don't clobber a display_name/avatar the user has since customized —
    // only fill the row when it's genuinely absent.
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);

  // `ignoreDuplicates` makes the upsert a no-op once the row exists, which froze
  // identity-owned fields forever: after an email change at the provider, the
  // profile kept the old address indefinitely — and that column is what any
  // admin/support query reads. Refresh just those, leaving display_name alone.
  const { error: refreshErr } = await supabase
    .from('profiles')
    .update({
      email: user.email ?? null,
      ...(meta?.avatar_url || meta?.picture
        ? { avatar_url: meta.avatar_url || meta.picture }
        : {}),
    })
    .eq('id', user.id);
  if (refreshErr) throw new Error(refreshErr.message);
}

export async function updateProfile(patch: Partial<Pick<ProfileRow, 'display_name' | 'avatar_url'>>): Promise<void> {
  const supabase = getSupabaseBrowser();
  if (!supabase) throw new Error('Auth is not configured.');
  const { data: auth } = await supabase.auth.getUser();
  // Used to resolve normally with no session, so the settings UI reported a
  // saved profile that was never written.
  if (!auth.user) throw new Error('Not signed in.');
  const { error } = await supabase.from('profiles').update(patch).eq('id', auth.user.id);
  if (error) throw new Error(error.message);
}

/** Human label for a user, guest-aware. */
export function userLabel(user: User | null): string {
  if (!user) return 'Guest';
  if (user.is_anonymous) return 'Guest';
  const meta = user.user_metadata as { full_name?: string; name?: string } | undefined;
  return meta?.full_name || meta?.name || user.email || 'Account';
}
