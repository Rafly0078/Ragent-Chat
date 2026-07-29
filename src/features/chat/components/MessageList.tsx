'use client';

import { useEffect } from 'react';
import type { Conversation } from '@/types';
import { MessageBubble, type MessageActions } from './MessageBubble';
import { CompactionBadge } from './CompactionBadge';
import { ScrollToBottomButton } from './ScrollToBottomButton';
import { useAutoScroll } from '@/lib/hooks/use-auto-scroll';

interface Props {
  conversation: Conversation;
  generating: boolean;
  actions: MessageActions;
}

export function MessageList({ conversation, generating, actions }: Props) {
  const messages = conversation.messages;
  const summary = conversation.summary;
  // Depend on the last message's content length so streaming keeps us pinned.
  // Reasoning length is included too: while a model is still "thinking" the
  // content stays empty, so without it the view stopped following the visibly
  // growing reasoning panel.
  const last = messages[messages.length - 1];
  const scrollDep = `${messages.length}:${last?.content.length ?? 0}:${last?.reasoning?.length ?? 0}`;
  const { ref, atBottom, scrollToBottom, handleScroll } = useAutoScroll<HTMLDivElement>(scrollDep);

  // Jump to the bottom instantly when switching conversations.
  useEffect(() => {
    scrollToBottom('auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={ref}
        onScroll={handleScroll}
        className="scrollbar-thin h-full overflow-y-auto"
        role="log"
        aria-live="polite"
        aria-label="Conversation messages"
      >
        <div className="pb-4 pt-2">
          {messages.map((msg, i) => (
            <div key={msg.id}>
              <MessageBubble
                message={msg}
                isLast={i === messages.length - 1}
                generating={generating}
                actions={actions}
                conversationId={conversation.id}
              />
              {summary?.upToMessageId === msg.id && (
                <CompactionBadge text={summary.text} createdAt={summary.createdAt} />
              )}
            </div>
          ))}
        </div>
      </div>
      <ScrollToBottomButton visible={!atBottom} onClick={() => scrollToBottom()} />
    </div>
  );
}
