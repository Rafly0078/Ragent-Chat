'use client';

import { useEffect, useMemo } from 'react';
import type { Conversation, Message } from '@/types';
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
  // Depend on how much of the last message exists so streaming keeps us pinned.
  // `reasoning` is included because while a model is thinking the content stays
  // empty, so without it the view stopped following the visibly growing panel.
  // Both are the flattened mirrors of `parts`, so this sums across every
  // interleaved block — keying on the last block alone would stop following
  // once a second thinking block opened.
  const last = messages[messages.length - 1];
  const scrollDep = `${messages.length}:${last?.content.length ?? 0}:${last?.reasoning?.length ?? 0}:${last?.parts?.length ?? 0}`;
  const { ref, atBottom, scrollToBottom, handleScroll } = useAutoScroll<HTMLDivElement>(scrollDep);

  // Jump to the bottom instantly when switching conversations.
  useEffect(() => {
    scrollToBottom('auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  // Every message but the live one, memoized.
  //
  // `messages` gets a new identity on every streamed frame, so mapping it here
  // re-created a wrapper <div> and a <MessageBubble> element for all N messages
  // ~60x/sec, then ran N memo comparisons to discard them. (`MessageBubble` is
  // memoized and `actions` is stable, so the bubbles themselves correctly bailed
  // out — but the allocation and comparison still happened, and `cv-auto` only
  // skips layout and paint, never reconciliation.) At 200 messages that was ~400
  // element allocations per frame for one token of new text.
  //
  // The key is what makes this safe: `appendToMessage`/`appendReasoning`
  // deliberately skip `touch()`, so `updatedAt` does NOT move while tokens
  // stream — but every other mutation (edit, delete, the terminal
  // `updateMessage` that ends a stream) goes through `touch()` and does move it.
  // So this recomputes exactly when a settled message can actually have changed,
  // and not once during a stream.
  const settledKey = `${conversation.id}:${messages.length}:${conversation.updatedAt}`;

  const settledRows = useMemo(
    () =>
      messages
        .slice(0, -1)
        .map((msg) => (
          <Row
            key={msg.id}
            message={msg}
            isLast={false}
            generating={generating}
            actions={actions}
            conversationId={conversation.id}
            summary={summary}
          />
        )),
    // `messages` is deliberately not a dep — `settledKey` is its proxy. Between
    // key changes the only message that can have changed is the last one, and
    // that one is sliced off here, so the closed-over array is never stale for
    // what this actually renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settledKey, generating, actions, summary, conversation.id],
  );

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
        {/* One growing child, and only one. `useAutoScroll` attaches its
            ResizeObserver to `el.children` once at mount, so a second direct
            child here — a sticky date header, a sentinel, the thinking field
            hoisted out of its turn — is never observed, and content that grows
            without changing `scrollDep` silently detaches the view from the
            bottom again. */}
        <div className="pb-6 pt-3">
          {settledRows}
          {last && (
            <Row
              key={last.id}
              message={last}
              isLast
              generating={generating}
              actions={actions}
              conversationId={conversation.id}
              summary={summary}
            />
          )}
        </div>
      </div>
      <ScrollToBottomButton visible={!atBottom} onClick={() => scrollToBottom()} />
    </div>
  );
}

/** One message plus the compaction marker that may sit under it. */
function Row({
  message,
  isLast,
  generating,
  actions,
  conversationId,
  summary,
}: {
  message: Message;
  isLast: boolean;
  generating: boolean;
  actions: MessageActions;
  conversationId: string;
  summary: Conversation['summary'];
}) {
  return (
    <div>
      <MessageBubble
        message={message}
        isLast={isLast}
        generating={generating}
        actions={actions}
        conversationId={conversationId}
      />
      {summary?.upToMessageId === message.id && (
        <CompactionBadge text={summary.text} createdAt={summary.createdAt} />
      )}
    </div>
  );
}
