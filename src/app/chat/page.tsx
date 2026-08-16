'use client';

import { useCallback, useEffect, useState } from 'react';
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
import { useChatHydrated, useHydrated } from '@/lib/hooks/use-hydrated';
import { useIsMobile } from '@/lib/hooks/use-media-query';
import { useKeyboardShortcuts } from '@/lib/hooks/use-keyboard-shortcuts';
import { apiConfigured } from '@/lib/api/config';
import { MessageSkeleton } from '@/components/ui/skeleton';

export default function HomePage() {
  const hydrated = useHydrated();
  /** The store, not React. See the effect below. */
  const chatsLoaded = useChatHydrated();
  const isMobile = useIsMobile();

  // Primitives only. Selecting `s.conversations` here meant this component —
  // and therefore the sidebar, ambient background, offline banner and command
  // palette — re-rendered on every streamed frame, because `appendToMessage`
  // returns a new array each time. `ChatView` subscribes to the active
  // conversation itself; everything below just needs to know which one it is.
  const activeId = useChatStore((s) => s.activeId);
  const conversationCount = useChatStore((s) => s.conversations.length);
  const firstConversationId = useChatStore((s) => s.conversations[0]?.id ?? null);
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

  const activeConversationId = activeId ?? firstConversationId;

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
  //
  // Gated on the STORE having loaded, not just on React having mounted. The snapshot
  // comes out of IndexedDB now, so "no conversations" is true for a few frames on
  // every single load — acting on it there greeted returning users with a spurious
  // empty "New chat" (and, once signed in, synced it to the cloud).
  useEffect(() => {
    if (!hydrated || !chatsLoaded) return;
    if (!apiConfigured()) return;
    if (conversationCount === 0) {
      newChat();
      return;
    }
    if (!activeId && firstConversationId) setActive(firstConversationId);
  }, [hydrated, chatsLoaded, activeId, conversationCount, firstConversationId, setActive, newChat]);

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
    // The terminal palette, scoped to this route the way `.terminal-field` is
    // scoped to the landing. It wraps everything rather than just the shell
    // because `AmbientBackground`, `OfflineBanner` and `CommandPalette` are
    // siblings of it, and outside the scope they would read `:root`'s paper
    // tokens — the page's own backdrop included.
    //
    // It has to stay a plain div. No transform, filter, backdrop-filter, contain
    // or will-change here or on anything above the two dialogs inside ChatView:
    // nothing in this tree is portalled, so they escape their flex column only
    // because no ancestor creates a containing block.
    <div className="terminal-field terminal-app">
      <AmbientBackground />
      <OfflineBanner />

      <div className="flex h-[100dvh] overflow-hidden">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onNewChat={newChat} />

        <main className="relative flex min-w-0 flex-1 flex-col">
          {!hydrated || !chatsLoaded ? (
            <div className="flex-1 pt-10">
              <MessageSkeleton />
              <MessageSkeleton />
            </div>
          ) : !apiConfigured() ? (
            <ApiConfigNotice />
          ) : activeConversationId ? (
            <ChatView
              conversationId={activeConversationId}
              onToggleSidebar={() => setSidebarOpen((o) => !o)}
            />
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
    </div>
  );
}
