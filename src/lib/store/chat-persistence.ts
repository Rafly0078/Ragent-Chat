'use client';

import type { PersistStorage, StorageValue } from 'zustand/middleware';
import type { Attachment, Conversation } from '@/types';
import { notify } from '@/components/ui/toast';
import {
  ATTACHMENT_STORE,
  SNAPSHOT_STORE,
  idbDelete,
  idbEntries,
  idbGet,
  idbKeys,
  idbPut,
} from './idb';

/**
 * Where the chat history is kept, and how often.
 *
 * Two problems, one seam. The first is *rate*: during streaming the store updates
 * once per animation frame, so a naive persist writes the entire conversation set
 * ~60 times a second. Writes are coalesced here — deferred, latest-only, at most one
 * per `delayMs`. This is a `PersistStorage` rather than a `StateStorage` behind
 * `createJSONStorage` for exactly that reason: `createJSONStorage` serializes in its
 * own `setItem`, i.e. before handing the value down here, so wrapping it deferred the
 * write but not the cost of producing it.
 *
 * The second is *size*, which is why the bytes land in IndexedDB (see `./idb`)
 * instead of localStorage. Attachment blobs and extracted text are split into their
 * own records, written once each and left alone, so a flush during streaming rewrites
 * the text of the conversation and not the megabytes of base64 hanging off it.
 *
 * localStorage remains as the fallback for a browser that refuses IndexedDB, and as
 * the source of the one-time migration below — with `slimSnapshot` still doing what
 * it always did when 5 MB is all there is.
 */

/** The per-attachment payload, kept out of the snapshot. */
interface AttachmentBlob {
  base64?: string;
  text?: string;
  previewUrl?: string;
}

interface ChatSnapshot {
  conversations?: Conversation[];
  activeId?: string | null;
  recentModels?: string[];
}

/** True for the parts of an attachment that are bulk rather than description. */
const hasBlob = (att: Attachment) =>
  att.base64 !== undefined || att.text !== undefined || att.previewUrl !== undefined;

const isPersistable = (value: unknown): value is StorageValue<ChatSnapshot> =>
  !!value && typeof value === 'object' && 'state' in value;
/**
 * Take the blobs out of a snapshot, without touching the objects the store is still
 * using: every level that changes is shallow-copied, and a message or conversation
 * with nothing to strip is passed through by reference. That matters twice over —
 * mutating in place would blank the attachments the UI is rendering, and an untouched
 * subtree costs nothing to structured-clone by identity.
 */
function splitBlobs(value: StorageValue<ChatSnapshot>): {
  snapshot: StorageValue<ChatSnapshot>;
  blobs: Map<string, AttachmentBlob>;
} {
  const blobs = new Map<string, AttachmentBlob>();
  const conversations = value.state.conversations;
  if (!Array.isArray(conversations)) return { snapshot: value, blobs };

  const stripped = conversations.map((convo) => {
    let convoTouched = false;
    const messages = (convo.messages ?? []).map((msg) => {
      if (!msg.attachments?.some(hasBlob)) return msg;
      convoTouched = true;
      const attachments = msg.attachments.map((att) => {
        if (!hasBlob(att)) return att;
        blobs.set(att.id, { base64: att.base64, text: att.text, previewUrl: att.previewUrl });
        const { base64: _b, text: _t, previewUrl: _p, ...rest } = att;
        return rest;
      });
      return { ...msg, attachments };
    });
    return convoTouched ? { ...convo, messages } : convo;
  });

  return {
    snapshot: { ...value, state: { ...value.state, conversations: stripped } },
    blobs,
  };
}

/** Put the blobs back, so nothing downstream knows they were ever apart. */
function joinBlobs(
  value: StorageValue<ChatSnapshot>,
  blobs: Map<string, AttachmentBlob>,
): StorageValue<ChatSnapshot> {
  if (blobs.size === 0) return value;
  const conversations = value.state.conversations;
  if (!Array.isArray(conversations)) return value;

  for (const convo of conversations) {
    for (const msg of convo.messages ?? []) {
      if (!msg.attachments?.length) continue;
      msg.attachments = msg.attachments.map((att) => {
        const blob = blobs.get(att.id);
        return blob ? { ...att, ...blob } : att;
      });
    }
  }
  return value;
}
/**
 * The fallback path's last resort: drop what can be reconstructed so the part the
 * user can't get back — the conversation text — still fits in 5 MB. Only reachable
 * when IndexedDB is unavailable, since that is the only case where the snapshot and
 * its blobs share one budget.
 */
function slimSnapshot(json: string): string | null {
  try {
    const parsed = JSON.parse(json) as { state?: { conversations?: Conversation[] } };
    const conversations = parsed.state?.conversations;
    if (!Array.isArray(conversations)) return null;

    for (const convo of conversations) {
      for (const msg of convo.messages ?? []) {
        if (msg.attachments) {
          msg.attachments = msg.attachments.map((att) => ({
            ...att,
            base64: undefined,
            previewUrl: undefined,
          }));
        }
        const artifacts = msg.metadata?.artifacts;
        if (Array.isArray(artifacts)) {
          msg.metadata = {
            ...msg.metadata,
            artifacts: artifacts.map((a) => {
              const art = a as { url?: string };
              return typeof art.url === 'string' && art.url.startsWith('data:')
                ? { ...art, url: undefined }
                : art;
            }),
          };
        }
      }
    }
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
}

/** Every attachment id the snapshot still refers to, blob or not. */
function liveAttachmentIds(value: StorageValue<ChatSnapshot>): Set<string> {
  const ids = new Set<string>();
  for (const convo of value.state.conversations ?? []) {
    for (const msg of convo.messages ?? []) {
      for (const att of msg.attachments ?? []) ids.add(att.id);
    }
  }
  return ids;
}
export function chatStorage(delayMs: number): PersistStorage<unknown> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingKey: string | null = null;
  let pendingValue: StorageValue<unknown> | null = null;
  let flushing = false;

  /** Set once IndexedDB has failed us — everything after that goes to localStorage. */
  let idbBroken = typeof indexedDB === 'undefined';
  /** The state object last written. Reference equality is enough: store updates are
   *  immutable, so identical references mean nothing to save — which is most flushes,
   *  since transient fields like `generatingFiles` are not in the persisted slice. */
  let lastWritten: ChatSnapshot | null = null;
  /** Attachment records known to exist, so a flush writes only what is new. */
  let knownBlobs = new Set<string>();
  /** A localStorage snapshot that has been read but not yet superseded in IndexedDB.
   *  Dropped only after the first successful write, so an interrupted migration
   *  leaves the old copy exactly where it was. */
  let migratedFrom: string | null = null;
  let degraded = false;
  let warned = false;

  const writeLocal = (key: string, value: StorageValue<unknown>): void => {
    let json: string;
    try {
      json = JSON.stringify(value);
    } catch {
      return;
    }
    const tryWrite = (payload: string) => {
      try {
        window.localStorage.setItem(key, payload);
        return true;
      } catch {
        return false;
      }
    };
    if (!degraded && tryWrite(json)) return;

    const slim = slimSnapshot(json);
    if (slim && tryWrite(slim)) {
      if (!degraded) {
        degraded = true;
        console.warn(
          '[chat-store] localStorage quota exceeded — persisting without image ' +
            'attachments and inline file data. Message text is unaffected.',
        );
        notify(
          'Local storage is full. Chats are still saved, but attached images and ' +
            'generated files are no longer kept across reloads — delete some old chats to free space.',
          'error',
        );
      }
      return;
    }
    if (!warned) {
      warned = true;
      console.error('[chat-store] Could not persist chats locally.');
      notify('Could not save chats locally — storage is full. Delete some old chats.', 'error');
    }
  };
  /** Schedule a flush unless one is already pending. */
  function arm(): void {
    if (timer === null) timer = setTimeout(() => void flush(), delayMs);
  }

  async function flush(): Promise<void> {
    // A flush that lands while one is in flight would write the same snapshot twice
    // and, worse, race the blob bookkeeping. Re-arm instead.
    if (flushing) {
      arm();
      return;
    }
    const key = pendingKey;
    const value = pendingValue;
    // Reset first: whatever happens below, the next setItem must be able to schedule
    // a fresh flush.
    pendingKey = null;
    pendingValue = null;
    timer = null;
    if (key === null || value === null || !isPersistable(value)) return;

    const state = value.state;
    if (
      lastWritten &&
      lastWritten.conversations === state.conversations &&
      lastWritten.activeId === state.activeId &&
      lastWritten.recentModels === state.recentModels
    ) {
      return;
    }

    flushing = true;
    try {
      if (idbBroken) {
        writeLocal(key, value);
        lastWritten = state;
        return;
      }
      const { snapshot, blobs } = splitBlobs(value);
      try {
        for (const [id, blob] of blobs) {
          if (knownBlobs.has(id)) continue;
          await idbPut(ATTACHMENT_STORE, id, blob);
          knownBlobs.add(id);
        }
        // An attachment the snapshot no longer mentions at all — its message or its
        // whole conversation was deleted — takes its record with it. Keyed on the
        // attachment still EXISTING rather than on it still carrying a payload, so a
        // snapshot that merely omits the bytes can never delete them.
        const live = liveAttachmentIds(value);
        for (const id of [...knownBlobs]) {
          if (live.has(id)) continue;
          await idbDelete(ATTACHMENT_STORE, id);
          knownBlobs.delete(id);
        }
        await idbPut(SNAPSHOT_STORE, key, snapshot);
        lastWritten = state;
        if (migratedFrom) {
          window.localStorage.removeItem(migratedFrom);
          migratedFrom = null;
        }
      } catch (err) {
        // Includes QuotaExceededError, which at IndexedDB's ceiling means the disk is
        // genuinely full rather than that we picked too small a box.
        console.warn('[chat-store] IndexedDB write failed — falling back:', err);
        idbBroken = true;
        writeLocal(key, value);
        lastWritten = state;
      }
    } finally {
      flushing = false;
      if (pendingKey !== null) arm();
    }
  }
  /** Write now — the tab is going away. `pagehide` rather than `beforeunload`, and
   *  `visibilitychange` beside it, because a mobile browser freezes or discards a
   *  backgrounded tab without firing either of the ones people usually reach for.
   *
   *  The one thing IndexedDB costs us here: a transaction started this late is not
   *  guaranteed to commit, where a synchronous localStorage write always did. Browsers
   *  do let pending IDB transactions finish during unload, and the debounce window is
   *  a second, so the exposure is the last second before an abrupt close — against
   *  which the cloud sync, not this, is the real durability story. */
  const flushNow = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    void flush();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushNow);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushNow();
    });
  }

  return {
    /**
     * Read the snapshot, blobs stitched back in.
     *
     * Falls back to localStorage when IndexedDB has nothing — which is both the
     * migration path for an existing history and the answer for a browser that
     * refuses IndexedDB. Returning the old copy here is what makes the migration
     * invisible: the store hydrates from it exactly as before, and the first flush
     * lands in IndexedDB.
     */
    getItem: async (key: string) => {
      if (typeof window === 'undefined') return null;
      if (!idbBroken) {
        try {
          const stored = await idbGet<StorageValue<ChatSnapshot>>(SNAPSHOT_STORE, key);
          knownBlobs = new Set(await idbKeys(ATTACHMENT_STORE));
          if (stored && isPersistable(stored)) {
            const blobs = new Map(await idbEntries<AttachmentBlob>(ATTACHMENT_STORE));
            return joinBlobs(stored, blobs);
          }
        } catch (err) {
          console.warn('[chat-store] IndexedDB read failed — using localStorage:', err);
          idbBroken = true;
        }
      }
      const raw = window.localStorage.getItem(key);
      if (typeof raw !== 'string') return null;
      try {
        const parsed = JSON.parse(raw) as StorageValue<unknown>;
        if (!idbBroken) {
          // Keep the old copy until a write has actually landed elsewhere, and queue
          // that write now rather than waiting for the user to change something: a
          // returning reader who only reads would otherwise stay on localStorage —
          // and its full 5 MB — indefinitely.
          migratedFrom = key;
          pendingKey = key;
          pendingValue = parsed;
          arm();
        }
        return parsed;
      } catch {
        return null;
      }
    },

    setItem: (key: string, value: StorageValue<unknown>) => {
      pendingKey = key;
      pendingValue = value;
      arm();
    },

    removeItem: (key: string) => {
      pendingKey = null;
      pendingValue = null;
      lastWritten = null;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      window.localStorage.removeItem(key);
      if (!idbBroken) void idbDelete(SNAPSHOT_STORE, key).catch(() => {});
    },
  };
}
