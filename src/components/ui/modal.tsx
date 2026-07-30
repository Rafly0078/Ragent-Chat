'use client';

import { useCallback, useEffect, useId, useRef } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  className,
  footer,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  footer?: React.ReactNode;
  /** Set false for a mandatory dialog: no X button, no Escape, no backdrop click. */
  dismissible?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<Element | null>(null);
  const headingId = useId();
  const descriptionId = useId();

  // Close on Escape and lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, dismissible]);

  /**
   * Focus management. The panel declared `aria-modal="true"` but never moved
   * focus into itself, never trapped Tab, and never restored focus on close — so
   * keyboard and screen-reader users kept traversing the page *behind* the
   * backdrop, and after closing, focus sat on <body>. Six dialogs share this
   * component, including the mandatory sign-in wall.
   */
  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement;
    const panel = panelRef.current;
    // Prefer the first natural control (e.g. a text input); fall back to the
    // panel itself, which carries tabIndex={-1}.
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    return () => {
      const previous = restoreFocus.current;
      restoreFocus.current = null;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open]);

  const onPanelKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null,
    );
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-4">
          <m.div
            className="absolute inset-0 bg-[rgb(0_0_58_/_0.88)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={dismissible ? onClose : undefined}
          />
          <m.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            {...(title ? { 'aria-labelledby': headingId } : { 'aria-label': 'Dialog' })}
            {...(description ? { 'aria-describedby': descriptionId } : {})}
            onKeyDown={onPanelKeyDown}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className={cn(
              'popover relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl pb-[env(safe-area-inset-bottom)] shadow-card outline-none sm:max-w-lg sm:rounded-3xl sm:pb-0',
              className,
            )}
          >
            {(title || description) && (
              <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
                <div>
                  {title && (
                    <h2 id={headingId} className="text-lg font-semibold text-content">
                      {title}
                    </h2>
                  )}
                  {description && (
                    <p id={descriptionId} className="mt-0.5 text-sm text-content-muted">
                      {description}
                    </p>
                  )}
                </div>
                {dismissible && (
                  <button
                    onClick={onClose}
                    className="btn-ghost -mr-2 -mt-1 h-8 w-8 rounded-lg"
                    aria-label="Close dialog"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
            <div className="scrollbar-thin overflow-y-auto px-5 py-4">{children}</div>
            {footer && (
              <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
                {footer}
              </div>
            )}
          </m.div>
        </div>
      )}
    </AnimatePresence>
  );
}
