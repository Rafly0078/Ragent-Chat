'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import Link from 'next/link';
import { Plus, Search, Settings2, X } from 'lucide-react';
import { useChatStore } from '@/lib/store/chat-store';
import { useSettings } from '@/lib/store/settings-store';
import { ChatListItem } from './ChatListItem';
import { dateBucket } from '@/lib/utils/format';
import { useHydrated } from '@/lib/hooks/use-hydrated';
import { useIsMobile } from '@/lib/hooks/use-media-query';
import { Kbd } from '@/components/ui/kbd';
import { BrandMark } from '@/components/BrandMark';

interface Props {
  open: boolean;
  onClose: () => void;
  onNewChat: () => void;
}

const SIDEBAR_WIDTH = 288;

/**
 * How far left the closed mobile drawer parks.
 *
 * Not simply `-SIDEBAR_WIDTH`: `.popover` carries shadow-3, whose second layer
 * is an 80px blur at -24px spread, so a drawer parked at exactly its own width
 * still bleeds a soft dark band down the left edge of the screen. That was
 * invisible while the drawer unmounted when closed; now that it stays mounted,
 * it would be permanent.
 */
const DRAWER_PARKED_X = SIDEBAR_WIDTH + 96;

/** The only fields the sidebar list needs. */
interface Row {
  id: string;
  title: string;
  pinned: boolean;
  updatedAt: number;
}

export function Sidebar({ open, onClose, onNewChat }: Props) {
  /**
   * Subscribe to a primitive SIGNATURE of the list, not a projected array.
   *
   * `useShallow` compares array *elements* with `Object.is`, and `.map()` mints
   * fresh objects on every call — so a projected `{id, title, …}[]` was never
   * equal to the previous snapshot. `useSyncExternalStore` then saw the snapshot
   * change on every render and looped: React error #185, "Maximum update depth
   * exceeded", crashing the whole page on load. Strings compare by value, so a
   * joined signature settles.
   *
   * It still skips the streaming re-render, which was the point: `appendToMessage`
   * doesn't touch `updatedAt`/`title`/`pinned`, so the signature is unchanged for
   * every token.
   */
  const signature = useChatStore((s) =>
    s.conversations.map((c) => `${c.id}${c.updatedAt}${c.pinned ? 1 : 0}${c.title}`).join(''),
  );

  // Derived non-reactively — `signature` above is what triggers recomputation.
  const rows = useMemo<Row[]>(
    () =>
      useChatStore.getState().conversations.map((c) => ({
        id: c.id,
        title: typeof c.title === 'string' ? c.title : 'Untitled',
        pinned: c.pinned === true,
        updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : 0,
      })),
    // `signature` is intentionally the only dep: it's the reactive trigger, and
    // the store read inside is deliberately untracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );

  const activeId = useChatStore((s) => s.activeId);
  const setActive = useChatStore((s) => s.setActive);
  const query = useChatStore((s) => s.searchQuery);
  const setQuery = useChatStore((s) => s.setSearchQuery);
  const defaultModel = useSettings((s) => s.defaultModel);
  const isMobile = useIsMobile();
  const hydrated = useHydrated();

  // Debounce the raw query so the expensive message-body scan doesn't run on
  // every keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  const { pinned, groups } = useMemo(
    () => filterAndGroup(rows, debouncedQuery),
    [rows, debouncedQuery],
  );

  // One identity for every row, so `ChatListItem`'s memo actually holds.
  const select = useCallback(
    (id: string) => {
      setActive(id);
      if (isMobile) onClose();
    },
    [setActive, isMobile, onClose],
  );

  const content = (
    <div className="flex h-full flex-col">
      {/* Header — the mark, the wordmark, and on mobile the close affordance. The
          mark is bare now: a tinted rounded tile around it was the one piece of
          chrome on this surface that existed only to hold a logo. */}
      <div className="flex items-center gap-2.5 px-[var(--term-gutter)] pb-3 pt-4">
        <BrandMark className="h-[1.15rem] w-[1.15rem] shrink-0 text-content" />
        <span className="flex-1 font-mono text-[0.82rem] tracking-[0.14em] text-content">
          ragent
        </span>
        {isMobile && (
          <button
            onClick={onClose}
            className="btn-ghost btn-sm btn-icon"
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* The sidebar's single action. Bordered rather than filled: a full-width
          inverse-video bar was the brightest thing on the screen, above the
          transcript it exists to add to. It inverts on hover, which is how the
          rest of this surface says "this one". */}
      <div className="px-[var(--term-gutter)]">
        <button
          onClick={onNewChat}
          className="term-btn term-btn-ghost focus-ring h-10 w-full justify-start"
        >
          <Plus className="h-4 w-4" /> new chat
        </button>
      </div>

      {/* Search. The chip advertises the shortcut that actually focuses this
          field (Ctrl/Cmd+F in use-keyboard-shortcuts) — it hides while typing so
          it never sits under the clear button. */}
      <div className="px-[var(--term-gutter)] pb-2 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-subtle" />
          <input
            id="sidebar-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search"
            aria-label="Search conversations"
            className="input h-9 pl-8 pr-14 font-mono text-[0.8rem]"
          />
          {query ? (
            <button
              onClick={() => setQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-1 text-content-subtle transition-colors duration-fast hover:text-content"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <Kbd mod className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
              F
            </Kbd>
          )}
        </div>
      </div>

      {/* List */}
      <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-3" aria-label="Conversations">
        {/* Gated on hydration: the store rehydrates from localStorage before the
            first client render, so rendering this straight from persisted state
            produced a server/client mismatch in guest-only deployments. */}
        {hydrated && rows.length === 0 && (
          <p className="px-3 py-8 font-mono text-xs leading-6 text-content-subtle">
            no conversations yet.
            <br />
            start one above.
          </p>
        )}
        {hydrated && rows.length > 0 && pinned.length === 0 && groups.length === 0 && (
          <p className="px-3 py-8 font-mono text-xs text-content-subtle">no match for “{query}”</p>
        )}

        {pinned.length > 0 && (
          <Section title="Pinned">
            {pinned.map((c) => (
              <ChatListItem
                key={c.id}
                id={c.id}
                title={c.title}
                pinned={c.pinned}
                active={c.id === activeId}
                onSelect={select}
              />
            ))}
          </Section>
        )}
        {groups.map(([bucket, items]) => (
          <Section key={bucket} title={bucket}>
            {items.map((c) => (
              <ChatListItem
                key={c.id}
                id={c.id}
                title={c.title}
                pinned={c.pinned}
                active={c.id === activeId}
                onSelect={select}
              />
            ))}
          </Section>
        ))}
      </nav>

      {/* Footer. The default-model line is the sidebar's status rail: the same
          mono micro-caps the top bar and the composer report state in. */}
      <div className="border-border/12 border-t px-[var(--term-gutter)] pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5">
        <Link
          href="/settings"
          className="term-btn term-btn-ghost focus-ring h-9 w-full justify-start border-transparent px-2"
        >
          <Settings2 className="h-4 w-4" /> settings
        </Link>
        <p className="mt-2 truncate px-2 font-mono text-[0.64rem] uppercase tracking-[0.12em] text-content-subtle">
          {defaultModel ? `default · ${defaultModel}` : 'private by design'}
        </p>
      </div>
    </div>
  );

  // Mobile: overlay drawer. Desktop: collapsible inline panel.
  //
  // The drawer takes `.popover`, the same elevated surface every menu and dialog
  // uses: overlay fill, functional border, shadow-3. That is what makes it read
  // as lifted above a dimmed page rather than as the page having slid sideways.
  //
  // The branch is gated on `hydrated`, and the desktop panel carries `md:block`
  // rather than trusting the branch alone. `useIsMobile()` reports false on the
  // server and on the client's first render (see use-media-query), so a purely
  // JS-driven split painted the full-width desktop panel on a phone for a frame
  // before the effect flipped it — a visible sideways lurch on every load. With
  // the media query in CSS, first paint is already right at any width, and the
  // drawer (which animates, so it must not be present until it is wanted) only
  // mounts once the viewport is actually known.
  if (hydrated && isMobile) {
    return (
      <>
        {/* The scrim still mounts on demand — it is one empty div, and fading it
            in/out is the whole reason `AnimatePresence` is here. */}
        <AnimatePresence>
          {open && (
            <m.div
              className="scrim fixed inset-0 z-40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={onClose}
            />
          )}
        </AnimatePresence>

        {/* The drawer, by contrast, stays mounted and slides.
            Mounting it on open meant React built the header, the search field
            and every conversation row in the same frame the spring started, so
            the first frames of the animation were spent on layout instead of
            movement — the stutter this fixes. Mounted once, an open is a pure
            transform the compositor can carry.

            `inert` (not just `pointer-events`) while closed: an off-screen
            drawer that keeps its rows in the tab order and in the accessibility
            tree is worse than the jank was. */}
        <m.aside
          inert={!open}
          initial={false}
          animate={{ x: open ? 0 : -DRAWER_PARKED_X }}
          transition={{ type: 'spring', stiffness: 400, damping: 40 }}
          className="popover fixed inset-y-0 left-0 z-50 w-72 max-w-[88vw] rounded-none border-y-0 border-l-0"
        >
          {content}
        </m.aside>
      </>
    );
  }

  // Desktop: instant open/close (the brief asks for instant, and animating
  // `width` is disallowed). The slot is present only when open; the inner
  // content gets a subtle transform/opacity entrance — no layout animation.
  if (!open) return null;
  return (
    <aside
      className="glass relative z-20 hidden h-full shrink-0 overflow-hidden border-0 motion-safe:animate-fade-in md:block"
      style={{ width: SIDEBAR_WIDTH }}
    >
      {content}
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <p className="px-2 pb-1.5 pt-3 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-content-subtle">
        {title}
      </p>
      <div className="space-y-px">{children}</div>
    </div>
  );
}

function filterAndGroup(rows: Row[], query: string) {
  const q = query.trim().toLowerCase();
  // Message bodies are read non-reactively: subscribing to them would undo the
  // whole point of the projection above. The memo re-runs whenever a title/pin/
  // updatedAt changes, and `updateMessage` bumps `updatedAt`, so results stay
  // current — only the tokens of a still-streaming reply aren't searchable yet.
  const bodies = q
    ? new Map(
        useChatStore.getState().conversations.map((c) => [
          c.id,
          (c.messages ?? [])
            .map((m) => m.content ?? '')
            .join('\n')
            .toLowerCase(),
        ]),
      )
    : null;

  const matches = rows.filter((c) => {
    if (!q) return true;
    if (c.title.toLowerCase().includes(q)) return true;
    return bodies?.get(c.id)?.includes(q) ?? false;
  });

  const pinned = matches.filter((c) => c.pinned).sort((a, b) => b.updatedAt - a.updatedAt);

  const unpinned = matches.filter((c) => !c.pinned).sort((a, b) => b.updatedAt - a.updatedAt);

  const bucketMap = new Map<string, Row[]>();
  for (const c of unpinned) {
    const bucket = dateBucket(c.updatedAt);
    const arr = bucketMap.get(bucket) ?? [];
    arr.push(c);
    bucketMap.set(bucket, arr);
  }

  return { pinned, groups: Array.from(bucketMap.entries()) };
}
