/**
 * Context compaction — keep long conversations within the model's window by
 * condensing older turns into a running summary instead of sending the full
 * transcript every request.
 *
 * The flow (driven from use-chat):
 *  1. estimate the token cost of what would be sent this turn;
 *  2. if it crosses `COMPACT_RATIO` of the conversation's context length,
 *     keep the most recent messages verbatim up to a token reserve and ask the
 *     model to summarize everything older (folding any previous summary in so
 *     nothing is lost);
 *  3. store the new summary + the id of the last message it covers.
 *
 * Recent messages are held by token budget, not a fixed count, so a single
 * code paste larger than the reserve can't force several huge messages to stay
 * and overflow the window. When even that isn't enough (a lone message bigger
 * than num_ctx), `stillOverBudget` lets the caller warn the user.
 *
 * toApiMessages then injects that summary and drops the covered messages, so
 * the model keeps the memory at a fraction of the token cost.
 */

import type { ConversationSummary, Message } from '@/types';
import type { ApiChatMessage } from '@/lib/api/types';
import { estimateMessageTokens, estimateTokens } from '@/lib/utils/format';

/** Compact once the prompt is estimated to exceed this fraction of num_ctx. */
export const COMPACT_RATIO = 0.7;
/**
 * How much of the window to reserve for the most recent messages kept verbatim.
 * These are preserved by *token budget*, not by count: a single huge code paste
 * fills the reserve on its own, so we never force-keep multiple giant messages
 * that would blow past the window. The rest is condensed into the summary.
 */
export const KEEP_RECENT_RATIO = 0.4;
/**
 * Floor on verbatim recent messages regardless of size — the current question
 * and the answer it replies to must never be summarized away, or the model
 * would be answering a prompt it can no longer see.
 */
const MIN_KEEP_RECENT = 2;
/** Don't bother compacting a span smaller than this — not worth an LLM call. */
const MIN_MESSAGES_TO_COMPACT = 2;

/** Estimated tokens for the whole live prompt (summary + attachments + text). */
export function estimateHistoryTokens(
  messages: Message[],
  systemPrompt: string,
  summary?: ConversationSummary,
): number {
  let total = estimateTokens(systemPrompt);
  if (summary?.text) total += estimateTokens(summary.text);
  // Only messages after the summary marker are actually sent.
  let counted = messages;
  if (summary?.upToMessageId) {
    const cut = messages.findIndex((m) => m.id === summary.upToMessageId);
    if (cut !== -1) counted = messages.slice(cut + 1);
  }
  for (const m of counted) total += estimateMessageTokens(m);
  return total;
}

/**
 * Walk backward from the newest message, keeping messages verbatim until their
 * combined size would exceed `tokenBudget`. Always keeps at least
 * `MIN_KEEP_RECENT` messages so the current question and its immediate context
 * survive even when they're individually larger than the budget. Returns the
 * index of the first message to KEEP — everything before it is summarizable.
 *
 * The kept slice never STARTS on an assistant turn. It could, and then the
 * request began with an answer to a question the model could no longer see:
 * Anthropic rejects that outright ("first message must use the user role") and
 * every other protocol reads it as the model having spoken unprompted. One extra
 * message is a cheap price for a well-formed conversation.
 */
function recentKeepStart(messages: Message[], tokenBudget: number): number {
  let used = 0;
  let kept = 0;
  let i = messages.length - 1;
  for (; i >= 0; i--) {
    const cost = estimateMessageTokens(messages[i]!);
    // Once we've met the floor, stop as soon as the next message would overflow
    // the reserve — but only if it isn't the very message we started on.
    if (kept >= MIN_KEEP_RECENT && used + cost > tokenBudget) break;
    used += cost;
    kept++;
  }
  let start = i + 1;
  // Reach back over an answer (and the tool traffic that produced it) to the turn
  // that asked for it. `system` is hoisted out of `messages` by every protocol
  // builder, so only 'user' is a valid opening.
  while (start > 0 && start < messages.length && messages[start]!.role !== 'user') start--;
  return start;
}

/**
 * Decide whether compaction should run and, if so, which messages to fold in.
 * Returns the slice to summarize and the id of its last message (the new
 * cutoff), or null when nothing needs doing.
 */
export function planCompaction(
  messages: Message[],
  systemPrompt: string,
  contextLength: number,
  summary?: ConversationSummary,
): { toSummarize: Message[]; upToMessageId: string } | null {
  const budget = contextLength * COMPACT_RATIO;
  if (estimateHistoryTokens(messages, systemPrompt, summary) <= budget) return null;

  // Start after whatever the current summary already covers.
  let start = 0;
  if (summary?.upToMessageId) {
    const cut = messages.findIndex((m) => m.id === summary.upToMessageId);
    if (cut !== -1) start = cut + 1;
  }

  // Keep the most recent messages verbatim up to a token reserve (not a fixed
  // count) so one giant code paste can't force several huge messages to stay.
  const keepFrom = recentKeepStart(messages, contextLength * KEEP_RECENT_RATIO);

  // Fold in everything between the summary cutoff and the recent-keep window,
  // never summarizing a message that is still streaming or errored.
  const span = messages.slice(start, keepFrom).filter((m) => !m.streaming && !m.error);

  if (span.length < MIN_MESSAGES_TO_COMPACT) return null;
  return { toSummarize: span, upToMessageId: span[span.length - 1]!.id };
}

/**
 * After compaction has done all it can, is the prompt still estimated to exceed
 * the hard window? This happens when the messages that must stay verbatim (the
 * recent reserve) are themselves larger than the window — e.g. a single code
 * paste bigger than num_ctx. No summarization strategy can fix that; the caller
 * should warn the user to raise Context Length or split the input.
 */
export function stillOverBudget(
  messages: Message[],
  systemPrompt: string,
  contextLength: number,
  summary?: ConversationSummary,
): boolean {
  return estimateHistoryTokens(messages, systemPrompt, summary) > contextLength;
}

const SUMMARIZER_SYSTEM =
  'You compress chat history into durable memory. Produce a concise, factual summary ' +
  "that preserves everything needed to continue the conversation: the user's goals and " +
  'constraints, decisions made, key facts and definitions established, code or file names ' +
  'referenced, and any open questions or next steps. Use tight bullet points. Do not add ' +
  'commentary, greetings, or information that was not in the conversation.';

/** Render a slice of messages into a plain transcript for the summarizer. */
function renderTranscript(messages: Message[]): string {
  return messages
    .map((m) => {
      const who = m.role === 'assistant' ? 'Assistant' : m.role === 'user' ? 'User' : 'System';
      const attach = (m.attachments ?? [])
        .map((a) =>
          a.text ? `\n[file ${a.name}]:\n${a.text}` : a.base64 ? `\n[image ${a.name}]` : '',
        )
        .join('');
      return `${who}: ${m.content}${attach}`;
    })
    .join('\n\n');
}

/**
 * Build the (non-streaming) chat request messages that ask the model to
 * summarize `toSummarize`, folding in any prior summary so memory accumulates
 * rather than resets.
 */
export function buildSummaryMessages(
  toSummarize: Message[],
  previous?: ConversationSummary,
): ApiChatMessage[] {
  const priorBlock = previous?.text
    ? `Existing summary of the conversation so far:\n${previous.text}\n\n---\n\n`
    : '';
  const transcript = renderTranscript(toSummarize);
  return [
    { role: 'system', content: SUMMARIZER_SYSTEM },
    {
      role: 'user',
      content:
        `${priorBlock}New messages to fold into the summary:\n\n${transcript}\n\n---\n\n` +
        'Return a single updated summary that merges the existing summary (if any) with the new messages. ' +
        'Output only the summary.',
    },
  ];
}
