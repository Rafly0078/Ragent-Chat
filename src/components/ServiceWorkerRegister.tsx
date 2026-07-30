'use client';

import { useEffect } from 'react';
import { installListener } from '@/lib/hooks/use-pwa-install';

/**
 * Registers the service worker (/sw.js) on the client after the page loads.
 * The SW is a pass-through (no caching) — it exists solely to make the app
 * meet the PWA installability criteria. Registration is deferred to
 * `onload` so it never blocks first paint or TTI.
 *
 * Also wires the `beforeinstallprompt` capture at app start: Chrome fires that
 * event once, seconds after load, so waiting until the Settings → Install tab
 * mounted `usePWAInstall` meant it was always missed.
 *
 * We register in dev too (on localhost) so the install button works while
 * testing — Chrome treats localhost as a secure context for PWA purposes.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    installListener();
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // SW registration failure is non-fatal — the app still works as a
        // normal website; only installability is affected.
      });
    };

    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}
