'use client';

import { useEffect, useState } from 'react';
import { useChatStore } from '@/lib/store/chat-store';

/**
 * True once React has taken over on the client.
 *
 * Reading persisted state during SSR/first paint causes hydration mismatches, so gate
 * client-only content on this flag.
 *
 * It says nothing about the chat store having loaded — see `useChatHydrated`. That
 * distinction did not exist while the store read localStorage synchronously, and
 * conflating them is what made an empty store on the first frame indistinguishable
 * from a user with no chats.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

/**
 * True once the chat store's persisted state has actually arrived.
 *
 * The snapshot lives in IndexedDB, so hydration is a round trip rather than a
 * synchronous read: for a few frames after mount the store legitimately holds no
 * conversations. Anything that reacts to *emptiness* — creating a first chat,
 * choosing an active conversation, merging with the cloud — has to wait for this or
 * it acts on a store that simply hasn't spoken yet.
 *
 * Checked inside the effect as well as at first render, because hydration can finish
 * in the gap between the two and `onFinishHydration` only fires once.
 */
export function useChatHydrated(): boolean {
  const [ready, setReady] = useState(() => useChatStore.persist.hasHydrated());
  useEffect(() => {
    if (useChatStore.persist.hasHydrated()) {
      setReady(true);
      return;
    }
    return useChatStore.persist.onFinishHydration(() => setReady(true));
  }, []);
  return ready;
}
