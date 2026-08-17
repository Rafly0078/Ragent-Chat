'use client';

import { lazy, Suspense, useMemo, useState } from 'react';
import type { Conversation } from '@/types';
import { useChatStore } from '@/lib/store/chat-store';
import { useThinkingStore } from '@/lib/store/thinking-store';
import { useChat } from '../hooks/use-chat';
import { useModels } from '@/features/models/use-models';
import { TopBar } from './TopBar';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { EmptyState } from './EmptyState';
import { ParamsPanel } from './ParamsPanel';
import { SystemPromptEditor } from './SystemPromptEditor';
import type { MessageActions } from './MessageBubble';
import { useToast } from '@/components/ui/toast';
import { copyText } from '@/lib/utils/clipboard';
/**
 * Code-split: 438 lines, rendered only once a conversation has produced a
 * generated file. Statically imported it rode along in the chat route chunk for
 * every visitor, including the majority who never generate a document.
 */
const ArtifactPanel = lazy(() =>
  import('@/features/artifacts/ArtifactPanel').then((m) => ({ default: m.ArtifactPanel })),
);
import type { Artifact } from '@/lib/tools/types';
import { useSettings } from '@/lib/store/settings-store';
import {
  providerSupportsThinking,
  providerThinkingEfforts,
  providerThinkingKey,
} from '@/lib/api/config';
import { DEFAULT_SEARCH_MODE, DEFAULT_THINKING } from '@/lib/store/defaults';

interface Props {
  conversationId: string;
  onToggleSidebar: () => void;
}

/**
 * Subscribes to just this one conversation, so the page shell above it doesn't
 * have to.
 *
 * The page used to select the whole `conversations` array and find the active
 * one itself. `appendToMessage` mints a new array and a new conversation object
 * on every flush, so that selector's identity changed ~60x/sec while streaming
 * — which re-rendered the page, and with it the sidebar, the ambient
 * background, the offline banner and the command palette, none of which had
 * anything to do with the token that arrived. Narrowing the subscription to
 * here means a streaming frame re-renders the chat column and nothing else.
 *
 * One hook before the conditional return, so hook order stays stable; the real
 * body is `ChatViewInner` below.
 */
export function ChatView({ conversationId, onToggleSidebar }: Props) {
  const conversation = useChatStore((s) => s.conversations.find((c) => c.id === conversationId));
  if (!conversation) return null;
  return <ChatViewInner conversation={conversation} onToggleSidebar={onToggleSidebar} />;
}

function ChatViewInner({
  conversation,
  onToggleSidebar,
}: {
  conversation: Conversation;
  onToggleSidebar: () => void;
}) {
  const generatingId = useChatStore((s) => s.generatingId);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const setSystemPrompt = useChatStore((s) => s.setConversationSystemPrompt);
  const setParams = useChatStore((s) => s.setConversationParams);
  const setThinking = useChatStore((s) => s.setConversationThinking);
  const setSearchMode = useChatStore((s) => s.setConversationSearchMode);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const { models } = useModels();
  const { toast } = useToast();
  const provider = useSettings((s) => s.apiProvider);
  const providerProtocol = useSettings((s) => s.providerProtocol);
  const defaultSearchMode = useSettings((s) => s.defaultSearchMode);
  // Conversations predating the search modes have no value of their own; they
  // follow the global default rather than silently reading as "off".
  const searchMode = conversation.searchMode ?? defaultSearchMode ?? DEFAULT_SEARCH_MODE;
  const providerThinkingUnsupported = !providerSupportsThinking(provider, providerProtocol);
  const thinkingKey = providerThinkingKey(conversation.model, provider, providerProtocol);
  const thinkingUnsupported = useThinkingStore((s) => s.unsupported.has(thinkingKey));
  // OpenAI protocol only accepts low|medium|high; `max` is hidden from the
  // picker and clamped to the highest allowed level here, so a conversation
  // already persisted at `max` doesn't display a level it can't use. The
  // stored value is left alone — switching back to Anthropic restores it.
  const thinkingEfforts = useMemo(
    () => providerThinkingEfforts(provider, providerProtocol),
    [provider, providerProtocol],
  );
  const thinking = useMemo(() => {
    const current = conversation.thinking ?? DEFAULT_THINKING;
    if (thinkingEfforts.includes(current.effort)) return current;
    return { ...current, effort: thinkingEfforts[thinkingEfforts.length - 1] ?? 'high' };
  }, [conversation.thinking, thinkingEfforts]);

  const { send, stop, regenerate, continueGeneration, editUserMessage } = useChat(conversation.id);

  const [paramsOpen, setParamsOpen] = useState(false);
  const [systemOpen, setSystemOpen] = useState(false);

  const generating = generatingId === conversation.id;
  const hasMessages = conversation.messages.length > 0;
  const visionCapable = models.find((m) => m.name === conversation.model)?.supportsVision;

  const actions: MessageActions = useMemo(
    () => ({
      onCopy: (text) => {
        void copyText(text).then((ok) => {
          if (!ok) toast('Could not copy — the clipboard needs an HTTPS page.', 'error');
        });
      },
      onEdit: (id, content) => void editUserMessage(id, content),
      onDelete: (id) => deleteMessage(conversation.id, id),
      onRegenerate: (id) => void regenerate(id),
      onContinue: (id) => void continueGeneration(id),
      onRetry: (id) => void regenerate(id),
    }),
    [conversation.id, deleteMessage, editUserMessage, regenerate, continueGeneration, toast],
  );

  // Every artifact this conversation has produced, kept as one element.
  //
  // `conversation.messages` is a new array on every streamed frame, so keying on
  // it meant the whole history was re-filtered and re-flatMapped ~60x/sec — and
  // the panel got a new `artifacts` array each time. `ArtifactPanel` is not
  // memoized, so it and its N cards (each with their own state and signed-URL
  // effects) re-rendered for tokens that changed no file. `updatedAt` is the same
  // proxy ContextMeter and MessageList use: the append writers skip `touch()`, and
  // an artifact only ever lands via `updateMessage`, which doesn't.
  const artifactPanel = useMemo(() => {
    const artifacts: Artifact[] = conversation.messages
      .filter((m) => m.role === 'assistant' && !m.streaming)
      .flatMap((m) => (m.metadata?.artifacts as Artifact[]) ?? []);
    if (artifacts.length === 0) return null;
    return (
      <Suspense fallback={null}>
        <ArtifactPanel artifacts={artifacts} />
      </Suspense>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id, conversation.updatedAt]);

  const handleSlash = (command: string) => {
    switch (command) {
      case '/system':
        setSystemOpen(true);
        break;
      case '/params':
        setParamsOpen(true);
        break;
      case '/clear':
        clearMessages(conversation.id);
        toast('Messages cleared');
        break;
      case '/model':
        toast('Pick a model from the top bar', 'info');
        break;
      case '/export':
        toast('Use the ⋮ menu to export', 'info');
        break;
      default:
        break;
    }
  };

  return (
    <div className="flex h-full flex-col">
      <TopBar
        conversation={conversation}
        onToggleSidebar={onToggleSidebar}
        onOpenParams={() => setParamsOpen(true)}
        onOpenSystem={() => setSystemOpen(true)}
      />

      {hasMessages ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <MessageList conversation={conversation} generating={generating} actions={actions} />
          {artifactPanel}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <EmptyState onPick={(prompt) => void send(prompt, [])} />
        </div>
      )}

      <ChatInput
        disabled={!conversation.model}
        generating={generating}
        onSend={(text, atts, mode) => void send(text, atts, mode)}
        onStop={stop}
        onSlashCommand={handleSlash}
        visionCapable={visionCapable}
        conversationId={conversation.id}
        thinking={thinking}
        thinkingUnsupported={thinkingUnsupported || providerThinkingUnsupported}
        thinkingEfforts={thinkingEfforts}
        onThinkingChange={(patch) => setThinking(conversation.id, patch)}
        searchMode={searchMode}
        onSearchModeChange={(mode) => setSearchMode(conversation.id, mode)}
      />

      <ParamsPanel
        open={paramsOpen}
        onClose={() => setParamsOpen(false)}
        params={conversation.params}
        onChange={(patch) => setParams(conversation.id, patch)}
        model={conversation.model ?? ''}
      />
      <SystemPromptEditor
        open={systemOpen}
        onClose={() => setSystemOpen(false)}
        value={conversation.systemPrompt}
        onChange={(prompt) => setSystemPrompt(conversation.id, prompt)}
      />
    </div>
  );
}
