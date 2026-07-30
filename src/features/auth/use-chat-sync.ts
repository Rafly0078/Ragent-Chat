'use client';

/**
 * Bridges the local chat store to Supabase for signed-in users.
 *
 *  - On sign-in: load remote conversations and MERGE them with whatever is
 *    local, newest-wins per conversation. Local-only conversations are pushed up.
 *  - While signed in: debounced diff-sync — upsert changed conversations,
 *    delete removed ones. Streaming deltas don't bump updatedAt, so we don't
 *    write on every token; the save fires when a turn completes.
 *  - Guest / unconfigured: no-op. The store's localStorage persistence stands.
 */

import { useEffect, useRef } from 'react';
import type { Conversation } from '@/types';
import { useChatStore } from '@/lib/store/chat-store';
import { notify } from '@/components/ui/toast';
import { useAuth } from './AuthProvider';
import {
  deleteConversation as deleteRemote,
  loadConversations,
  saveConversation,
} from '@/lib/services/conversations.service';

const DEBOUNCE_MS = 800;

/**
 * Merge remote and local conversations, newest `updatedAt` wins per id.
 *
 * Hydration used to call `importConversations(remote, true)` — a full replace.
 * Anything local that hadn't been flushed yet (a failed write, a tab closed
 * inside the debounce window, edits made offline) was deleted from localStorage
 * too, and guest history was only migrated when the account had *zero* remote
 * conversations, so signing in with any existing cloud chat silently discarded
 * every local one.
 */
function mergeConversations(
  remote: Conversation[],
  local: Conversation[],
): { merged: Conversation[]; toPush: Conversation[] } {
  const byId = new Map<string, Conversation>();
  for (const c of remote) byId.set(c.id, c);

  const toPush: Conversation[] = [];
  for (const c of local) {
    const r = byId.get(c.id);
    if (!r) {
      // Local-only — keep it and push it up.
      byId.set(c.id, c);
      toPush.push(c);
    } else if (c.updatedAt > r.updatedAt) {
      byId.set(c.id, c);
      toPush.push(c);
    }
  }

  const merged = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  return { merged, toPush };
}

export function useChatSync(): void {
  const { user, isAuthenticated, isGuest, loading } = useAuth();
  // Sync for any real session (authenticated OR anonymous guest with a row).
  const active = Boolean(user) && !loading;
  const userId = user?.id ?? null;

  // Snapshot of what we believe is persisted, keyed by id → updatedAt.
  const persisted = useRef<Map<string, number>>(new Map());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedFor = useRef<string | null>(null);
  /** Set once hydration succeeded — no writes are allowed before that. */
  const hydrated = useRef(false);
  // Guards against overlapping debounced flushes (see below).
  const flushing = useRef(false);
  const dirty = useRef(false);
  const errorReported = useRef(false);

  const reportError = (err: unknown, what: string) => {
    console.warn(`[chat-sync] ${what} failed:`, err);
    if (errorReported.current) return;
    errorReported.current = true;
    notify(
      'Could not sync your chats to the cloud. They are still saved on this device.',
      'error',
    );
  };

  // Initial hydrate on (re)login.
  useEffect(() => {
    if (!active || !userId) return;
    if (hydratedFor.current === userId) return;

    let cancelled = false;
    (async () => {
      try {
        const remote = await loadConversations();
        if (cancelled) return;

        const local = useChatStore.getState().conversations;
        const { merged, toPush } = mergeConversations(remote, local);

        useChatStore.getState().importConversations(merged, true);
        persisted.current = new Map(merged.map((c) => [c.id, c.updatedAt]));

        // Mark hydrated BEFORE pushing so a concurrent flush isn't blocked, but
        // only after a successful load — setting the marker up-front (as it used
        // to) meant a failed load was never retried, and the next flush then
        // wrote local state over the remote rows it had never read.
        hydratedFor.current = userId;
        hydrated.current = true;

        for (const c of toPush) {
          if (cancelled) return;
          try {
            await saveConversation(c, userId);
          } catch (err) {
            reportError(err, 'initial upload');
          }
        }
      } catch (err) {
        hydratedFor.current = null;
        hydrated.current = false;
        reportError(err, 'load');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, userId]);

  // Reset hydration state when the user changes / signs out.
  useEffect(() => {
    if (!user) {
      hydratedFor.current = null;
      hydrated.current = false;
      persisted.current = new Map();
      errorReported.current = false;
    }
  }, [user, isAuthenticated, isGuest]);

  // Debounced diff-sync on store changes.
  useEffect(() => {
    if (!active || !userId) return;
    // Set by the cleanup below. A flush re-armed from its own `finally` used to
    // escape cleanup entirely (the timer didn't exist when clearTimeout ran) and
    // then wrote rows for the *previous* user after a sign-out or account switch.
    let cancelled = false;

    const flush = async () => {
      if (cancelled || !hydrated.current) return;
      // Guard against overlapping flushes — a debounce that fires while a
      // previous flush is still running would read the same snapshot and
      // duplicate every write. Instead, mark that we're dirty and re-run
      // after the current flush completes.
      if (flushing.current) {
        dirty.current = true;
        return;
      }
      flushing.current = true;

      try {
        const convos = useChatStore.getState().conversations;
        const seen = new Set<string>();
        const known = persisted.current;

        // Upsert new/changed.
        const changed: Conversation[] = [];
        for (const c of convos) {
          seen.add(c.id);
          const prev = known.get(c.id);
          if (prev === undefined || prev !== c.updatedAt) changed.push(c);
        }
        // Delete removed.
        const removed: string[] = [];
        for (const id of known.keys()) if (!seen.has(id)) removed.push(id);

        for (const c of changed) {
          try {
            await saveConversation(c, userId);
            known.set(c.id, c.updatedAt);
          } catch (err) {
            reportError(err, `save ${c.id}`);
          }
        }
        for (const id of removed) {
          try {
            await deleteRemote(id);
            known.delete(id);
          } catch (err) {
            reportError(err, `delete ${id}`);
          }
        }
      } finally {
        flushing.current = false;
        // If the store changed during the flush, schedule another one.
        if (dirty.current && !cancelled) {
          dirty.current = false;
          timer.current = setTimeout(flush, DEBOUNCE_MS);
        }
      }
    };

    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, DEBOUNCE_MS);
    };

    // Write immediately when the tab is being hidden or torn down; mobile
    // browsers freeze a backgrounded tab without warning, and up to DEBOUNCE_MS
    // of the conversation was simply lost.
    const flushNow = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      void flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushNow();
    };

    const unsub = useChatStore.subscribe(schedule);
    window.addEventListener('pagehide', flushNow);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      unsub();
      window.removeEventListener('pagehide', flushNow);
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      // Don't drop pending work on unmount — flush it, then stop accepting more.
      void flush().finally(() => {
        cancelled = true;
      });
    };
  }, [active, userId]);
}
