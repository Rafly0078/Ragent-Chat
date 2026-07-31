'use client';

import { useMemo } from 'react';
import type { Conversation, Message } from '@/types';
import { Tooltip } from '@/components/ui/tooltip';
import { estimateTokens } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

/** Small per-message overhead for role/formatting tokens in the chat template. */
const MESSAGE_OVERHEAD = 4;

/**
 * Estimate how many of the conversation's context window are currently in
 * use. Prefers the real `prompt_eval_count` + `eval_count` Ollama reported
 * for the most recent exchange (exact, since it reflects the model's own
 * tokenizer) and layers a cheap heuristic estimate on top for anything sent
 * or streamed since then, so the number keeps moving live while a reply is
 * still generating.
 */
function estimateContextUsage(convo: Conversation): number {
  const { messages, systemPrompt } = convo;

  let lastMetricsIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.metrics?.promptTokens != null) {
      lastMetricsIdx = i;
      break;
    }
  }

  if (lastMetricsIdx === -1) {
    // Nothing round-tripped through the API yet — estimate the whole thing.
    const sysTokens = estimateTokens(systemPrompt);
    const msgTokens = messages.reduce(
      (sum, m) => sum + estimateTokens(m.content) + MESSAGE_OVERHEAD,
      0,
    );
    return sysTokens + msgTokens;
  }

  const base = messages[lastMetricsIdx]!.metrics!;
  const baseTokens = (base.promptTokens ?? 0) + (base.completionTokens ?? 0);

  const newer = messages.slice(lastMetricsIdx + 1);
  const newerTokens = newer.reduce(
    (sum: number, m: Message) => sum + estimateTokens(m.content) + MESSAGE_OVERHEAD,
    0,
  );

  return baseTokens + newerTokens;
}

export function ContextMeter({ conversation }: { conversation: Conversation }) {
  const limit = conversation.params.contextLength;

  const used = useMemo(
    () => estimateContextUsage(conversation),
    // Re-estimate whenever the message list identity, length, or the
    // streaming/last message content changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversation.messages, conversation.systemPrompt],
  );

  if (!limit || conversation.messages.length === 0) return null;

  const pct = Math.min(100, (used / limit) * 100);
  const tone = pct >= 90 ? 'error' : pct >= 70 ? 'warning' : 'accent';

  return (
    <Tooltip
      label={`~${used.toLocaleString()} / ${limit.toLocaleString()} tokens in context${
        pct >= 70 ? ' — getting close to the limit' : ''
      }`}
      side="bottom"
    >
      <div className="hidden items-center gap-1.5 rounded-xl border border-border/15 px-2 py-1.5 md:flex">
        <div className="h-1.5 w-12 overflow-hidden rounded-full bg-border/15">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-300',
              tone === 'error' && 'bg-error',
              tone === 'warning' && 'bg-warning',
              tone === 'accent' && 'bg-accent',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span
          className={cn(
            'text-xs font-medium tabular-nums',
            tone === 'error'
              ? 'text-error'
              : tone === 'warning'
                ? 'text-warning'
                : 'text-content-subtle',
          )}
        >
          {Math.round(pct)}%
        </span>
      </div>
    </Tooltip>
  );
}
