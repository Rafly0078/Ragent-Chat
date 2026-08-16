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

import { useEffect, useRef, useState } from 'react';
import type { Conversation } from '@/types';
import { useChatStore } from '@/lib/store/chat-store';
import { useChatHydrated } from '@/lib/hooks/use-hydrated';
import { notify } from '@/components/ui/toast';
import { useAuth } from './AuthProvider';
import {
  deleteConversation as deleteRemote,
  loadConversations,
  saveConversation,
} from '@/lib/services/conversations.service';

const DEBOUNCE_MS = 800;
/** After a failure, before trying the same write again. */
const RETRY_MS = 4000;
/** Consecutive failed flushes before the user hears about it. One failure is a
 *  network blip, a token being refreshed, a server restarting — all of which the
 *  retry below fixes silently, and none of which deserve a toast that says a chat
 *  might not be saved. */
const FAILURES_BEFORE_REPORTING = 2;
/** Stop retrying after this many in a row: past here it is not a blip, and a flush
 *  every few seconds against a server that is refusing us helps nobody. The next
 *  store change arms a fresh attempt regardless. */
const MAX_RETRIES = 5;

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
  /**
   * Local hydration is asynchronous now that the snapshot lives in IndexedDB, and the
   * merge below reads local state: run it too early and it sees an empty store, pushes
   * nothing up, and then `importConversations(merged, true)` replaces whatever
   * hydration was about to deliver with the remote set — losing every local-only chat
   * on a slow read.
   */
  const localReady = useChatHydrated();

  // Sync for any real session (authenticated OR anonymous guest with a row).
  const active = Boolean(user) && !loading && localReady;
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
  /** Failed flushes in a row. Reset by the first success. */
  const failures = useRef(0);
  /** Bumped to re-enter the hydrate effect after a failed load. */
  const [loadAttempt, setLoadAttempt] = useState(0);

  const reportError = (err: unknown, what: string) => {
    console.warn(`[chat-sync] ${what} failed:`, err);
    failures.current += 1;
    if (errorReported.current || failures.current < FAILURES_BEFORE_REPORTING) return;
    errorReported.current = true;
    notify('Could not sync your chats to the cloud. They are still saved on this device.', 'error');
  };

  /** A write went through. Anything we said about being unable to sync is now false,
   *  so take it back rather than leaving a stale warning as the last word. */
  const reportRecovered = () => {
    failures.current = 0;
    if (!errorReported.current) return;
    errorReported.current = false;
    notify('Back in sync — your chats reached the cloud.', 'success');
  };

  // Initial hydrate on (re)login.
  useEffect(() => {
    if (!active || !userId) return;
    if (hydratedFor.current === userId) return;

    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
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
        reportRecovered();

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
        // A failed load is the one failure nothing else recovers from: no writes are
        // allowed until it succeeds, and the effect only re-runs when the session
        // changes. Bump the attempt counter to re-enter it under our own steam.
        if (!cancelled && failures.current <= MAX_RETRIES) {
          retry = setTimeout(() => setLoadAttempt((n) => n + 1), RETRY_MS);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, [active, userId, loadAttempt]);

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
      let failed = false;

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
            failed = true;
            reportError(err, `save ${c.id}`);
          }
        }
        for (const id of removed) {
          try {
            await deleteRemote(id);
            known.delete(id);
          } catch (err) {
            failed = true;
            reportError(err, `delete ${id}`);
          }
        }
        // Nothing to do also counts: a flush with no changes proves nothing about
        // the connection, so only an actual write clears a reported failure.
        if (!failed && (changed.length > 0 || removed.length > 0)) reportRecovered();
      } finally {
        flushing.current = false;
        // Re-run if the store changed during the flush, or if a write failed and is
        // still worth another go — the ids that failed are simply not in `known`, so
        // the next pass picks them up again with no extra bookkeeping.
        const retry = failed && failures.current <= MAX_RETRIES;
        if ((dirty.current || retry) && !cancelled) {
          dirty.current = false;
          timer.current = setTimeout(flush, retry ? RETRY_MS : DEBOUNCE_MS);
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
