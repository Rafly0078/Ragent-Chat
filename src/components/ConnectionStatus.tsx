'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Tooltip } from '@/components/ui/tooltip';
import { ping } from '@/lib/api/client';
import { API_CONFIG_CHANGED_EVENT, apiConfigured } from '@/lib/api/config';
import { useOnlineStatus } from '@/lib/hooks/use-online-status';
import { cn } from '@/lib/utils/cn';

type Status = 'checking' | 'online' | 'offline' | 'unconfigured';

/**
 * Live API health dot. Polls the API periodically and auto-reconnects with
 * backoff when it goes down; pauses polling while the browser is offline or the
 * tab is hidden.
 */
export function ConnectionStatus() {
  const [status, setStatus] = useState<Status>('checking');
  const online = useOnlineStatus();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempts = useRef(0);
  /**
   * Generation counter. `check()` reschedules itself, so every extra entry point
   * (mount, an `online` transition, the retry button) used to start a *second*
   * self-perpetuating chain whose handle immediately overwrote `timer.current` —
   * making the previous chain unreachable and therefore un-cancellable. It kept
   * pinging every 20s forever, even after this component unmounted. Only the
   * newest generation is allowed to continue.
   */
  const generation = useRef(0);

  const check = useCallback(async () => {
    const gen = ++generation.current;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }

    if (!apiConfigured()) {
      setStatus('unconfigured');
      return;
    }
    if (!navigator.onLine) {
      setStatus('offline');
      return;
    }
    // Nothing is looking at the dot in a background tab, and a request every
    // 20s from a page left open on a phone is a radio wake-up each time. Stop
    // the chain; the `visibilitychange` listener restarts it on return.
    if (document.visibilityState === 'hidden') return;
    setStatus((s) => (s === 'online' ? s : 'checking'));
    const ok = await ping();
    // Superseded or unmounted while the ping was in flight.
    if (gen !== generation.current) return;
    setStatus(ok ? 'online' : 'offline');
    attempts.current = ok ? 0 : attempts.current + 1;

    // Backoff: 20s when healthy, growing to 30s max while retrying.
    const delay = ok ? 20_000 : Math.min(5_000 * 2 ** (attempts.current - 1), 30_000);
    timer.current = setTimeout(check, delay);
  }, []);

  useEffect(() => {
    const gen = generation;
    const pending = timer;
    void check();
    return () => {
      // Bumping the generation stops any in-flight continuation from
      // rescheduling after unmount.
      gen.current++;
      if (pending.current) clearTimeout(pending.current);
    };
  }, [check]);

  // Re-check immediately when the browser comes back online. `useOnlineStatus`
  // starts at `true`, so skip the first run — the mount effect already checked.
  const firstOnlineRun = useRef(true);
  useEffect(() => {
    if (firstOnlineRun.current) {
      firstOnlineRun.current = false;
      return;
    }
    if (online) {
      attempts.current = 0;
      void check();
    } else {
      setStatus('offline');
    }
  }, [online, check]);

  useEffect(() => {
    const onConfigChanged = () => {
      attempts.current = 0;
      void check();
    };
    window.addEventListener(API_CONFIG_CHANGED_EVENT, onConfigChanged);
    return () => window.removeEventListener(API_CONFIG_CHANGED_EVENT, onConfigChanged);
  }, [check]);

  // Resume the moment the tab is looked at again, and re-check straight away —
  // whatever the dot was showing when the tab was backgrounded is stale.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        attempts.current = 0;
        void check();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [check]);

  const config = {
    checking: { color: 'bg-warning', label: 'Checking connection…' },
    online: { color: 'bg-success', label: 'Connected to API' },
    offline: { color: 'bg-error', label: 'API unreachable — retrying…' },
    unconfigured: { color: 'bg-content-subtle', label: 'API URL not configured' },
  }[status];

  return (
    <Tooltip label={config.label} side="bottom">
      <button
        onClick={() => {
          attempts.current = 0;
          void check();
        }}
        className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-border/5"
        aria-label={config.label}
      >
        <span className="relative flex h-2.5 w-2.5">
          {status === 'checking' && (
            <span
              className={cn(
                'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
                config.color,
              )}
            />
          )}
          <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', config.color)} />
        </span>
      </button>
    </Tooltip>
  );
}
