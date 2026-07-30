/**
 * Ollama Chat — Service Worker
 *
 * Minimal by design: it exists to satisfy PWA installability, not to cache the
 * app. There is deliberately NO fetch handler.
 *
 * A fetch handler used to sit here forwarding every request with
 * `event.respondWith(fetch(event.request))`. That routed 100% of traffic —
 * including the long-lived streamed chat response, chunk by chunk — through the
 * service worker thread for no benefit, and woke the SW on every navigation.
 * The justification ("Chrome requires a SW with a fetch handler") stopped being
 * true in Chrome 89; installability now only needs a registered SW plus a
 * manifest with icons.
 *
 * If real offline support is added later, this is where a cache-first strategy
 * for the app shell + /icon-*.png would go — explicitly bypassing /api/* and
 * any cross-origin request, so a chat response is never served from cache.
 */

const SW_VERSION = 'ollama-chat-v2';

self.addEventListener('install', () => {
  // Activate immediately on first install rather than waiting for a reload.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Claim clients so the SW controls the page immediately, and drop any caches
  // an earlier version of this file may have left behind.
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== SW_VERSION).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});
