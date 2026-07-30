'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Captures the `beforeinstallprompt` event so we can show a custom
 * "Install App" button in Settings instead of relying on the browser's
 * auto-prompt (which doesn't fire on all platforms — notably iOS Safari).
 *
 * Returns:
 *  - `canInstall`: true when the browser has stashed a deferred prompt
 *  - `installed`: true when the app is already running in standalone mode
 *  - `promptInstall()`: triggers the native install dialog
 *  - `platform`: quick check for iOS (which doesn't support beforeinstallprompt)
 */

/**
 * Module-scope capture. Chrome fires `beforeinstallprompt` once, shortly after
 * load — long before the user opens Settings → Install app, which is the only
 * place `usePWAInstall` is mounted. Listening from inside the hook therefore
 * meant the event was always missed and the install button never appeared.
 * `installListener()` is called from a component that mounts at app start.
 */
let stashed: BeforeInstallPromptEvent | null = null;
let appInstalled = false;
const subscribers = new Set<() => void>();
let wired = false;

function emit(): void {
  subscribers.forEach((fn) => fn());
}

/** Start listening for install events. Idempotent; safe to call repeatedly. */
export function installListener(): void {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    // Prevent the default browser prompt — we show our own button.
    e.preventDefault();
    stashed = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    appInstalled = true;
    stashed = null;
    emit();
  });
}

export function usePWAInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(stashed);
  const [installed, setInstalled] = useState(appInstalled);

  // Detect if already running as an installed PWA (standalone display mode).
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari uses a different media query.
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true);

  // iOS doesn't fire beforeinstallprompt — the user must use "Add to Home Screen"
  // manually from the Share sheet. We detect iOS Safari to show different UI.
  const isIOS =
    typeof window !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as unknown as { MSStream?: unknown }).MSStream;

  useEffect(() => {
    if (isStandalone) {
      setInstalled(true);
      return;
    }
    // Late mount: pick up whatever the module-scope listener already captured,
    // then follow further changes.
    installListener();
    const sync = () => {
      setDeferred(stashed);
      setInstalled(appInstalled);
    };
    sync();
    subscribers.add(sync);
    return () => {
      subscribers.delete(sync);
    };
  }, [isStandalone]);

  const promptInstall = useCallback(async () => {
    const prompt = deferred ?? stashed;
    if (!prompt) return;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') {
      appInstalled = true;
      setInstalled(true);
    }
    // The prompt can only be used once; clear it either way.
    stashed = null;
    setDeferred(null);
  }, [deferred]);

  return {
    canInstall: Boolean(deferred) && !installed,
    installed,
    isIOS,
    promptInstall,
  };
}

/**
 * Minimal interface for the non-standard BeforeInstallPromptEvent.
 * Chrome/Edge support this; Firefox/Safari do not.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
