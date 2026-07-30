'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, m } from 'framer-motion';
import {
  Eraser,
  FileJson,
  FileText,
  MoreVertical,
  PanelLeft,
  Settings2,
  Sliders,
  SquarePen,
  Trash2,
  Terminal,
} from 'lucide-react';
import type { Conversation } from '@/types';
import { ModelSelector } from '@/features/models/ModelSelector';
import { Tooltip } from '@/components/ui/tooltip';
import { useChatStore } from '@/lib/store/chat-store';
import { useToast } from '@/components/ui/toast';
import {
  conversationToJson,
  conversationToMarkdown,
  downloadText,
  slugify,
} from '@/lib/utils/export';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { ContextMeter } from './ContextMeter';

interface Props {
  conversation: Conversation;
  onToggleSidebar: () => void;
  onOpenParams: () => void;
  onOpenSystem: () => void;
}

export function TopBar({ conversation, onToggleSidebar, onOpenParams, onOpenSystem }: Props) {
  const setModel = useChatStore((s) => s.setConversationModel);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const exportMd = () => {
    downloadText(`${slugify(conversation.title)}.md`, conversationToMarkdown(conversation), 'text/markdown');
    toast('Exported as Markdown', 'success');
    setMenuOpen(false);
  };
  const exportJson = () => {
    downloadText(`${slugify(conversation.title)}.json`, conversationToJson(conversation), 'application/json');
    toast('Exported as JSON', 'success');
    setMenuOpen(false);
  };

  return (
    <header className="glass sticky top-0 z-30 flex items-center gap-1.5 border-0 px-2 py-2.5 sm:gap-2 sm:px-4">
      <Tooltip label="Toggle sidebar" side="bottom">
        <button onClick={onToggleSidebar} className="btn-ghost btn-md btn-icon" aria-label="Toggle sidebar">
          <PanelLeft className="h-[1.15rem] w-[1.15rem]" />
        </button>
      </Tooltip>

      {/* Divider, not padding — the reference separates chrome with rules. */}
      <span className="mx-0.5 hidden h-5 w-px bg-border/25 sm:block" aria-hidden />

      <ModelSelector value={conversation.model} onChange={(m) => setModel(conversation.id, m)} />

      {/* The session title is the navbar's one piece of content, so it gets the
          display face and nothing competes with it at this size. */}
      <div className="ml-1.5 hidden min-w-0 flex-1 sm:block">
        <p className="type-display truncate text-[1.0625rem] text-content">{conversation.title}</p>
      </div>

      <div className="flex flex-1 items-center justify-end gap-1 sm:flex-none">
        <ContextMeter conversation={conversation} />
        <ConnectionStatus />

        <span className="mx-0.5 hidden h-5 w-px bg-border/25 sm:block" aria-hidden />

        <Tooltip label="System prompt" side="bottom" className="hidden sm:inline-flex">
          <button onClick={onOpenSystem} className="btn-ghost btn-md btn-icon" aria-label="Edit system prompt">
            <Terminal className="h-[1.15rem] w-[1.15rem]" />
          </button>
        </Tooltip>

        <Tooltip label="Parameters" side="bottom" className="hidden sm:inline-flex">
          <button onClick={onOpenParams} className="btn-ghost btn-md btn-icon" aria-label="Generation parameters">
            <Sliders className="h-[1.15rem] w-[1.15rem]" />
          </button>
        </Tooltip>

        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="btn-ghost btn-md btn-icon"
            aria-label="More options"
            aria-haspopup="menu"
          >
            <MoreVertical className="h-[1.15rem] w-[1.15rem]" />
          </button>
          <AnimatePresence>
            {menuOpen && (
              <m.div
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ duration: 0.14 }}
                role="menu"
                className="popover absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-2xl p-1.5 shadow-card"
              >
                <MenuItem icon={FileText} label="Export as Markdown" onClick={exportMd} />
                <MenuItem icon={FileJson} label="Export as JSON" onClick={exportJson} />
                <MenuItem
                  icon={SquarePen}
                  label="Edit system prompt"
                  onClick={() => {
                    onOpenSystem();
                    setMenuOpen(false);
                  }}
                />
                <MenuItem
                  icon={Sliders}
                  label="Generation parameters"
                  onClick={() => {
                    onOpenParams();
                    setMenuOpen(false);
                  }}
                />
                <div className="my-1 h-px bg-border" />
                <MenuItem
                  icon={Eraser}
                  label="Clear messages"
                  onClick={() => {
                    clearMessages(conversation.id);
                    setMenuOpen(false);
                    toast('Messages cleared');
                  }}
                />
                <MenuItem
                  icon={Trash2}
                  label="Delete conversation"
                  danger
                  onClick={() => {
                    deleteConversation(conversation.id);
                    setMenuOpen(false);
                  }}
                />
              </m.div>
            )}
          </AnimatePresence>
        </div>

        <Tooltip label="Settings" side="bottom">
          <Link href="/settings" className="btn-ghost btn-md btn-icon" aria-label="Settings">
            <Settings2 className="h-[1.15rem] w-[1.15rem]" />
          </Link>
        </Tooltip>
      </div>
    </header>
  );
}

function MenuItem({
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
      className={`type-label flex w-full items-center gap-2.5 rounded px-3 py-2.5 text-left transition-colors ${
        danger
          ? 'text-error hover:bg-error/15'
          : 'text-content-muted hover:bg-accent/12 hover:text-content'
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </button>
  );
}
