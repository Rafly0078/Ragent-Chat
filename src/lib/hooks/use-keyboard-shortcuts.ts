'use client';

import { useEffect, useRef } from 'react';

export interface ShortcutHandlers {
  onCommandPalette: () => void;
  onNewChat: () => void;
  onToggleSidebar: () => void;
  onFocusSearch: () => void;
  onStop: () => void;
}

/**
 * Global keyboard shortcuts:
 *   Ctrl/Cmd+K       — command palette
 *   Ctrl/Cmd+B       — toggle sidebar
 *   Ctrl/Cmd+Shift+O — new chat
 *   Ctrl/Cmd+F       — focus chat search (when not in a text field)
 *   Escape           — stop generation
 * (Ctrl+Enter send is handled inside the input for correct focus semantics.)
 *
 * Handlers are kept in a ref so the global listener is registered once and
 * always dispatches to the latest callbacks — without re-subscribing on every
 * parent re-render (callers pass an inline object, so depending on `handlers`
 * directly would tear down and rebuild the listener on each render).
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const inField =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current.onCommandPalette();
        return;
      }
      if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        ref.current.onToggleSidebar();
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        ref.current.onNewChat();
        return;
      }
      if (mod && e.key.toLowerCase() === 'f' && !inField) {
        e.preventDefault();
        ref.current.onFocusSearch();
        return;
      }
      if (e.key === 'Escape' && !inField) {
        ref.current.onStop();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
