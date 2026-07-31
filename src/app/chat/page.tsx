'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AmbientBackground } from '@/components/AmbientBackground';
import { OfflineBanner } from '@/components/OfflineBanner';
import { ApiConfigNotice } from '@/components/ApiConfigNotice';
import { Sidebar } from '@/features/sidebar/Sidebar';
import { ChatView } from '@/features/chat/components/ChatView';
import { stopActiveGeneration } from '@/features/chat/hooks/use-chat';
import { CommandPalette } from '@/features/command/CommandPalette';
import { EmptyState } from '@/features/chat/components/EmptyState';
import { useChatStore } from '@/lib/store/chat-store';
import { useSettings } from '@/lib/store/settings-store';
import { useHydrated } from '@/lib/hooks/use-hydrated';
import { useIsMobile } from '@/lib/hooks/use-media-query';
import { useKeyboardShortcuts } from '@/lib/hooks/use-keyboard-shortcuts';
import { apiConfigured } from '@/lib/api/config';
import { MessageSkeleton } from '@/components/ui/skeleton';

export default function HomePage() {
  const hydrated = useHydrated();
  const isMobile = useIsMobile();

  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const setActive = useChatStore((s) => s.setActive);
  const createConversation = useChatStore((s) => s.createConversation);
  const generatingId = useChatStore((s) => s.generatingId);

  const settings = useSettings();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Collapse the sidebar by default on mobile once we know the viewport.
  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? conversations[0] ?? null,
    [conversations, activeId],
  );

  const newChat = useCallback(() => {
    createConversation({
      model: settings.defaultModel || undefined,
      systemPrompt: settings.defaultSystemPrompt,
      params: { ...settings.defaultParams },
    });
    if (isMobile) setSidebarOpen(false);
  }, [createConversation, settings, isMobile]);

  // Keep activeId valid after hydration. If there are no conversations at all,
  // create one so the fully-wired ChatView (whose EmptyState actually sends the
  // picked prompt) renders — the bare page-level EmptyState below can only start
  // a blank chat and would silently drop the prompt text the user clicked.
  useEffect(() => {
    if (!hydrated) return;
    if (!apiConfigured()) return;
    if (conversations.length === 0) {
      newChat();
      return;
    }
    if (!activeId && conversations[0]) setActive(conversations[0].id);
  }, [hydrated, activeId, conversations, setActive, newChat]);

  const focusSearch = useCallback(() => {
    setSidebarOpen(true);
    requestAnimationFrame(() => document.getElementById('sidebar-search')?.focus());
  }, []);

  const stopGeneration = useCallback(() => {
    if (generatingId) stopActiveGeneration();
  }, [generatingId]);

  useKeyboardShortcuts({
    onCommandPalette: () => setPaletteOpen((o) => !o),
    onNewChat: newChat,
    onToggleSidebar: () => setSidebarOpen((o) => !o),
    onFocusSearch: focusSearch,
    onStop: stopGeneration,
  });

  return (
    <>
      <AmbientBackground />
      <OfflineBanner />

      <div className="flex h-[100dvh] overflow-hidden">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onNewChat={newChat} />

        <main className="relative flex min-w-0 flex-1 flex-col">
          {!hydrated ? (
            <div className="flex-1 pt-10">
              <MessageSkeleton />
              <MessageSkeleton />
            </div>
          ) : !apiConfigured() ? (
            <ApiConfigNotice />
          ) : active ? (
            <ChatView conversation={active} onToggleSidebar={() => setSidebarOpen((o) => !o)} />
          ) : (
            <div className="flex-1 overflow-y-auto">
              <EmptyState onPick={() => newChat()} />
            </div>
          )}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNewChat={newChat}
      />
    </>
  );
}
