'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, m } from 'framer-motion';
import {
  MessageSquare,
  Moon,
  Plus,
  Search,
  Settings2,
  Sun,
  CornerDownLeft,
} from 'lucide-react';
import { useChatStore } from '@/lib/store/chat-store';
import { useSettings } from '@/lib/store/settings-store';
import { cn } from '@/lib/utils/cn';

interface Props {
  open: boolean;
  onClose: () => void;
  onNewChat: () => void;
}

interface Item {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
}

export function CommandPalette({ open, onClose, onNewChat }: Props) {
  const router = useRouter();
  const conversations = useChatStore((s) => s.conversations);
  const setActive = useChatStore((s) => s.setActive);
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Element to restore focus to when the palette closes. */
  const restoreFocus = useRef<Element | null>(null);

  useEffect(() => {
    if (open) {
      restoreFocus.current = document.activeElement;
      setQuery('');
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    // Focus was left on <body> after closing, so keyboard users lost their place.
    const previous = restoreFocus.current;
    if (previous instanceof HTMLElement) previous.focus();
    restoreFocus.current = null;
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const actions: Item[] = [
      { id: 'new', label: 'New chat', icon: Plus, run: () => { onNewChat(); onClose(); } },
      {
        id: 'theme',
        label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        icon: theme === 'dark' ? Sun : Moon,
        run: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
      },
      {
        id: 'settings',
        label: 'Open settings',
        icon: Settings2,
        run: () => { router.push('/settings'); onClose(); },
      },
    ];
    const convoItems: Item[] = conversations.map((c) => ({
      id: c.id,
      label: c.title,
      hint: `${c.messages.length} messages`,
      icon: MessageSquare,
      run: () => { setActive(c.id); onClose(); },
    }));
    const all = [...actions, ...convoItems];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((i) => i.label.toLowerCase().includes(q));
  }, [conversations, query, theme, onClose, onNewChat, router, setActive, setTheme]);

  useEffect(() => {
    // NaN-safe: `Math.min(NaN, n)` is NaN, so once the cursor went bad it could
    // never recover (see the arrow-key guards below).
    setCursor((c) => (Number.isFinite(c) ? Math.min(c, Math.max(0, items.length - 1)) : 0));
  }, [items.length]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      // The palette advertises ESC but had no handler, and the global shortcut
      // ignores keys pressed inside a field — so focus being in this input made
      // Escape a no-op and Ctrl/Cmd+K the only way out.
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      // `1 % 0` is NaN. With no results, one arrow press permanently broke
      // selection: no row highlighted and Enter did nothing for the rest of the
      // session.
      if (items.length === 0) return;
      setCursor((c) => ((Number.isFinite(c) ? c : -1) + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length === 0) return;
      setCursor((c) => ((Number.isFinite(c) ? c : 0) - 1 + items.length) % items.length);
    } else if (e.key === 'Enter') {
      // Only from the search field — a focused list button already runs its own
      // onClick, and handling both would fire the command twice.
      if (e.target !== inputRef.current) return;
      e.preventDefault();
      items[cursor]?.run();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[95] flex items-start justify-center p-4 pt-[12vh]"
          // Keep Escape working even if focus wandered out of the input.
          onKeyDown={onKeyDown}
        >
          <m.div
            className="absolute inset-0 bg-[rgb(0_0_58_/_0.88)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <m.div
            initial={{ opacity: 0, y: -16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 340, damping: 30 }}
            className="popover relative z-10 w-full max-w-xl overflow-hidden rounded-2xl shadow-card"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
          >
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search className="h-4 w-4 text-content-subtle" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chats or run a command…"
                className="h-12 flex-1 bg-transparent text-sm text-content outline-none placeholder:text-content-subtle"
                aria-label="Command palette search"
              />
              <kbd className="hidden rounded-md border border-border px-1.5 py-0.5 text-[0.65rem] text-content-subtle sm:block">
                ESC
              </kbd>
            </div>
            <div ref={listRef} className="scrollbar-thin max-h-80 overflow-y-auto p-1.5">
              {items.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-content-subtle">No results</p>
              )}
              {items.map((item, i) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onMouseEnter={() => setCursor(i)}
                    onClick={item.run}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors',
                      i === cursor ? 'bg-accent/15 text-content' : 'text-content-muted',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-accent" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.hint && <span className="text-xs text-content-subtle">{item.hint}</span>}
                    {i === cursor && <CornerDownLeft className="h-3.5 w-3.5 text-content-subtle" />}
                  </button>
                );
              })}
            </div>
          </m.div>
        </div>
      )}
    </AnimatePresence>
  );
}
