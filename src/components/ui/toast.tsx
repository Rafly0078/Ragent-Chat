'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastCtx {
  toast: (message: string, kind?: ToastKind) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

/**
 * Escape hatch for code that isn't a React component — the Zustand stores and
 * plain modules can't call `useToast()`, but they do have failures worth
 * surfacing (e.g. localStorage running out of quota). No-op until the provider
 * mounts, so it's always safe to call.
 */
let externalToast: ((message: string, kind?: ToastKind) => void) | null = null;
export function notify(message: string, kind: ToastKind = 'info'): void {
  externalToast?.(message, kind);
}

const icons = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
} as const;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const remove = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = ++counter.current;
      setToasts((t) => [...t, { id, kind, message }]);
      timers.current.set(
        id,
        setTimeout(() => remove(id), 4200),
      );
    },
    [remove],
  );

  // Clear any pending dismissals so they can't fire after unmount.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  // Publish/retract the non-React escape hatch alongside the provider's life.
  useEffect(() => {
    externalToast = toast;
    return () => {
      if (externalToast === toast) externalToast = null;
    };
  }, [toast]);

  // Stable context value — otherwise every `useToast()` consumer re-renders
  // whenever any toast is added or dismissed.
  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4"
        aria-live="polite"
        role="status"
      >
        <AnimatePresence>
          {toasts.map((t) => {
            const Icon = icons[t.kind];
            return (
              <m.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 20, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className="popover pointer-events-auto flex max-w-md items-start gap-3 px-4 py-3"
              >
                <Icon
                  className={
                    t.kind === 'success'
                      ? 'mt-0.5 h-5 w-5 shrink-0 text-success'
                      : t.kind === 'error'
                        ? 'mt-0.5 h-5 w-5 shrink-0 text-error'
                        : 'mt-0.5 h-5 w-5 shrink-0 text-accent'
                  }
                />
                <p className="text-sm text-content">{t.message}</p>
                <button
                  onClick={() => remove(t.id)}
                  className="ml-1 rounded-md p-0.5 text-content-subtle hover:text-content"
                  aria-label="Dismiss"
                >
                  <X className="h-4 w-4" />
                </button>
              </m.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
