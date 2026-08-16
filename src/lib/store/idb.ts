/**
 * The IndexedDB behind the chat store's persistence.
 *
 * localStorage was the wrong home for a chat history and the ceiling is why: ~5 MB
 * per origin, shared with everything else the app keeps, and the two things that
 * dominate the snapshot — base64 image attachments and `data:` URLs for files
 * generated in guest mode — are exactly the things a user can't get back. The store
 * already degraded gracefully when the quota blew (see `slimSnapshot`), but
 * degrading gracefully is not the same as fitting.
 *
 * IndexedDB is bounded by a share of free disk instead, and it stores structured
 * clones, so nothing here stringifies a megabyte of base64 once a second.
 *
 * Two object stores rather than one, because they have different write rates:
 *
 *   snapshots     one record, rewritten on every flush
 *   attachments   one record per attachment, written once and then left alone
 *
 * Deliberately hand-rolled. `idb` is 2 KB and pleasant, but this needs six
 * operations and no schema evolution beyond the one version below, and a dependency
 * in the persistence path of a user's entire history is a liability of its own.
 */

const DB_NAME = 'ragent-chat';
const DB_VERSION = 1;

export const SNAPSHOT_STORE = 'snapshots';
export const ATTACHMENT_STORE = 'attachments';

let db: Promise<IDBDatabase> | null = null;

/** Open (once) and keep the handle. Rejects where IndexedDB is unavailable. */
function open(): Promise<IDBDatabase> {
  if (db) return db;
  db = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
        database.createObjectStore(SNAPSHOT_STORE);
      }
      if (!database.objectStoreNames.contains(ATTACHMENT_STORE)) {
        database.createObjectStore(ATTACHMENT_STORE);
      }
    };
    req.onsuccess = () => {
      // A version change from another tab invalidates this handle; drop it so the
      // next call reopens rather than throwing InvalidStateError on every write.
      req.result.onversionchange = () => {
        req.result.close();
        db = null;
      };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  // A failed open must not be cached, or the first failure is permanent.
  db.catch(() => {
    db = null;
  });
  return db;
}

/** Run one transaction and resolve when it *commits*, not when the request does. */
function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T> | null,
): Promise<T | undefined> {
  return open().then(
    (database) =>
      new Promise<T | undefined>((resolve, reject) => {
        const transaction = database.transaction(store, mode);
        let result: T | undefined;
        const req = run(transaction.objectStore(store));
        if (req) req.onsuccess = () => (result = req.result);
        // Resolving on `oncomplete` is what makes a write durable from the caller's
        // point of view: a request can succeed and still be rolled back.
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = transaction.onerror = () =>
          reject(transaction.error ?? new Error('IndexedDB transaction failed'));
      }),
  );
}

export const idbGet = <T>(store: string, key: string): Promise<T | undefined> =>
  tx<T>(store, 'readonly', (s) => s.get(key) as IDBRequest<T>);

export const idbPut = (store: string, key: string, value: unknown): Promise<void> =>
  tx(store, 'readwrite', (s) => s.put(value, key)).then(() => undefined);

export const idbDelete = (store: string, key: string): Promise<void> =>
  tx(store, 'readwrite', (s) => s.delete(key)).then(() => undefined);

export const idbKeys = (store: string): Promise<string[]> =>
  tx<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys()).then((keys) =>
    (keys ?? []).map(String),
  );

/** Everything in one store, as [key, value] pairs. One cursor, one transaction. */
export function idbEntries<T>(store: string): Promise<Array<[string, T]>> {
  return open().then(
    (database) =>
      new Promise((resolve, reject) => {
        const transaction = database.transaction(store, 'readonly');
        const out: Array<[string, T]> = [];
        const req = transaction.objectStore(store).openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          out.push([String(cursor.key), cursor.value as T]);
          cursor.continue();
        };
        transaction.oncomplete = () => resolve(out);
        transaction.onabort = transaction.onerror = () =>
          reject(transaction.error ?? new Error('IndexedDB cursor failed'));
      }),
  );
}
