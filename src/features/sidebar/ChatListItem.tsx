'use client';

import { memo, useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import {
  Check,
  Copy,
  Download,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
  X,
} from 'lucide-react';
import { useChatStore } from '@/lib/store/chat-store';
import { conversationToMarkdown, downloadText, slugify } from '@/lib/utils/export';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils/cn';

interface Props {
  /**
   * Only the fields the row displays. The full conversation (with every message)
   * is read from the store on demand — passing it as a prop meant a new object
   * identity on every streamed token, re-rendering the whole list.
   */
  id: string;
  title: string;
  pinned: boolean;
  active: boolean;
  onSelect: () => void;
}

export const ChatListItem = memo(function ChatListItem({
  id,
  title,
  pinned,
  active,
  onSelect,
}: Props) {
  /**
   * Mount cost is the whole design of this component.
   *
   * A row is cheap on purpose: no store subscriptions, no JS animation driver,
   * and nothing the overflow menu needs until the menu is actually opened. The
   * mobile drawer mounts every row in the frame its open animation starts, so
   * anything paid here is paid N times inside one frame — which is what made
   * the drawer stutter on a phone.
   *
   * Actions therefore come from `getState()` at call time instead of four
   * `useChatStore(s => s.action)` selectors: they are stable for the store's
   * lifetime, so subscribing to them only ever cost 4×N subscriptions and
   * bought nothing.
   */
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const startRename = useCallback(() => {
    setDraft(title);
    setEditing(true);
    setMenuOpen(false);
  }, [title]);

  const commit = () => {
    setEditing(false);
    if (draft.trim()) useChatStore.getState().renameConversation(id, draft);
    else setDraft(title);
  };

  return (
    // A CSS entrance, not `m.div`. The animation is identical to the eye, but a
    // motion component per row spins up a driver per row; a keyframe is handed
    // to the compositor and costs nothing on the main thread after the first
    // frame.
    <div
      className={cn(
        'group/item relative flex items-center gap-1 rounded py-1 pl-3 pr-1 text-sm transition-colors',
        'motion-safe:animate-fade-in',
        // Skip layout/paint for rows scrolled out of the list — but never while
        // this row's menu is open, since the containment it implies would clip
        // the popover hanging below the row.
        !menuOpen && 'cv-row',
        active
          ? 'bg-accent/14 text-content'
          : 'text-content-muted hover:bg-border/[0.06] hover:text-content',
      )}
    >
      {/* Active state is a 2px accent rail down the leading edge, not a border
          box. It survives at any row height, never shifts the text, and reads
          instantly down a long list — a full outline on every row turns the
          sidebar into a ladder. */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-1 left-0 w-[2px] rounded-full transition-colors',
          active ? 'bg-accent' : 'bg-transparent',
        )}
      />
      <button
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left"
        aria-current={active}
      >
        {pinned ? (
          <Pin className="h-3.5 w-3.5 shrink-0 text-accent" />
        ) : (
          <MessageSquare
            className={cn(
              'h-3.5 w-3.5 shrink-0 transition-colors',
              active ? 'text-accent' : 'opacity-55',
            )}
          />
        )}
        {editing ? (
          <input
            ref={inputRef}
            aria-label={`Rename conversation ${title}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setDraft(title);
                setEditing(false);
              }
            }}
            className="input h-7 flex-1 px-1.5 py-0 text-sm"
          />
        ) : (
          <span
            className="truncate"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
          >
            {title}
          </span>
        )}
      </button>

      {/* Overflow menu trigger. Visible by default (touch-friendly); on
          devices with real hover support it stays quiet until the row is
          hovered/focused, so the list reads clean at rest on desktop. */}
      {!editing && (
        <div
          ref={menuRef}
          className="relative shrink-0 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:focus-within:opacity-100 [@media(hover:hover)]:group-hover/item:opacity-100"
        >
          <button
            aria-label="Chat options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((o) => !o);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-md text-content-subtle transition-colors hover:bg-border/10 hover:text-content"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>

          <AnimatePresence>
            {menuOpen && (
              <RowMenu
                id={id}
                pinned={pinned}
                containerRef={menuRef}
                onClose={closeMenu}
                onRename={startRename}
              />
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
});

/**
 * The overflow menu, mounted only while open.
 *
 * Everything the menu needs lives here rather than on the row: the toast
 * context, the delete-confirm state, and the outside-click listener. On the row
 * those were paid by every row in the list, forever, to serve the one menu a
 * user might open. Unmounting also resets the confirm step for free, which the
 * row previously needed a third effect for.
 */
function RowMenu({
  id,
  pinned,
  containerRef,
  onClose,
  onRename,
}: {
  id: string;
  pinned: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onRename: () => void;
}) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);

  // `containerRef` wraps the trigger as well as the menu, so tapping the trigger
  // stays a toggle instead of closing here and reopening on the click.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [containerRef, onClose]);

  const exportMarkdown = () => {
    const convo = useChatStore.getState().conversations.find((c) => c.id === id);
    if (!convo) return;
    downloadText(`${slugify(convo.title)}.md`, conversationToMarkdown(convo), 'text/markdown');
    toast('Exported as Markdown', 'success');
    onClose();
  };

  return (
    <m.div
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ duration: 0.14 }}
      role="menu"
      onClick={(e) => e.stopPropagation()}
      className="popover absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden p-1.5"
    >
      {!confirming ? (
        <>
          <MenuRow icon={Pencil} label="Rename" onClick={onRename} />
          <MenuRow
            icon={pinned ? PinOff : Pin}
            label={pinned ? 'Unpin' : 'Pin'}
            onClick={() => {
              useChatStore.getState().togglePin(id);
              onClose();
            }}
          />
          <MenuRow icon={Download} label="Export Markdown" onClick={exportMarkdown} />
          <MenuRow
            icon={Copy}
            label="Duplicate"
            onClick={() => {
              useChatStore.getState().duplicateConversation(id);
              onClose();
            }}
          />
          <div className="bg-border/12 my-1 h-px" />
          <MenuRow icon={Trash2} label="Delete" danger onClick={() => setConfirming(true)} />
        </>
      ) : (
        <div className="p-1.5">
          <p className="px-1.5 pb-2 text-xs text-content-muted">Delete this chat?</p>
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                useChatStore.getState().deleteConversation(id);
                onClose();
              }}
              className="btn-destructive btn-sm flex-1"
            >
              <Check className="h-3.5 w-3.5" /> Delete
            </button>
            <button onClick={() => setConfirming(false)} className="btn-ghost btn-sm flex-1">
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
          </div>
        </div>
      )}
    </m.div>
  );
}

function MenuRow({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={cn(
        'type-label flex w-full items-center gap-2.5 rounded px-3 py-2.5 text-left transition-colors',
        danger
          ? 'text-error hover:bg-error/15'
          : 'hover:bg-accent/12 text-content-muted hover:text-content',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </button>
  );
}
