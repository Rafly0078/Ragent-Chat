'use client';

import { useCallback, useRef } from 'react';
import type { Attachment, Message } from '@/types';
import { useChatStore } from '@/lib/store/chat-store';
import { useThinkingStore } from '@/lib/store/thinking-store';
import { ApiError, providerSupportsThinking, providerThinkingKey } from '@/lib/api/config';
import { streamChat, chat } from '@/lib/api/client';
import { toApiMessages, toApiOptions, type ChatStreamChunk } from '@/lib/api/types';
import { uid } from '@/lib/utils/id';
import { detectArtifacts } from '@/lib/tools/detect';
import { enrichPatches, extractCodeBlocks } from '@/lib/tools/patch';
import type { Artifact } from '@/lib/tools/types';
import { searchWeb } from '@/lib/search/client';
import { formatSearchContext, mergeSearchResponses, toSources } from '@/lib/search/format';
import { buildPlanMessages, parsePlan, fallbackPlan, type SearchPlan } from '@/lib/search/plan';
import {
  buildSummaryMessages,
  estimateHistoryTokens,
  planCompaction,
  stillOverBudget,
} from '@/lib/context/compaction';
import { useToast } from '@/components/ui/toast';

/**
 * The controller for the in-flight generation. Kept at module scope (only one
 * generation runs at a time) so it can be aborted from anywhere — e.g. the
 * global Esc shortcut — without threading refs through the component tree.
 */
let activeController: AbortController | null = null;

/** Abort the current generation, if any. Safe to call when idle. */
export function stopActiveGeneration(): void {
  activeController?.abort();
  activeController = null;
  useChatStore.getState().setGenerating(null);
}

/**
 * Deadline for the two auxiliary (non-streaming) model calls — context
 * compaction and search planning. Both run on the same local model as the chat,
 * where a long summarization can easily outlast the default 30s.
 */
const SUMMARY_TIMEOUT_MS = 120_000;
const PLAN_TIMEOUT_MS = 60_000;

/** Derive a short title from the first user message. */
function deriveTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'New chat';
  return clean.length > 48 ? `${clean.slice(0, 48)}…` : clean;
}

function metricsFromChunk(final: ChatStreamChunk, startedAt: number) {
  const responseTimeMs = Date.now() - startedAt;
  const completionTokens = final.eval_count;
  const promptTokens = final.prompt_eval_count;
  // eval_duration is in nanoseconds (Ollama). tokens/sec = tokens / seconds.
  let tokensPerSecond: number | undefined;
  if (completionTokens && final.eval_duration) {
    tokensPerSecond = completionTokens / (final.eval_duration / 1e9);
  } else if (completionTokens) {
    tokensPerSecond = completionTokens / (responseTimeMs / 1000);
  }
  return { responseTimeMs, completionTokens, promptTokens, tokensPerSecond };
}

export function useChat(conversationId: string | null) {
  const store = useChatStore;
  const executingRef = useRef<Set<string>>(new Set());
  // Conversation id we've already shown the "over context window" warning for,
  // so it fires once rather than on every over-budget turn.
  const overBudgetWarned = useRef<string | null>(null);
  const { toast } = useToast();

  /** Detect artifact directives in a completed message and execute them. */
  const processArtifacts = useCallback(
    async (convoId: string, messageId: string, content: string) => {
      const { requests, cleaned } = detectArtifacts(content);
      if (requests.length === 0) return;
      // Avoid double-execution if already in progress
      if (executingRef.current.has(messageId)) return;
      executingRef.current.add(messageId);

      try {
        // Strip artifact blocks from displayed content. Keep the original so we
        // can put it back if execution fails — otherwise a failed directive (e.g.
        // an unregistered tool) leaves a permanently blank message, since the
        // content was often ENTIRELY the artifact block ("return only the file").
        store.getState().updateMessage(convoId, messageId, { content: cleaned });

        const results = await Promise.allSettled(
          requests.map(async (req) => {
            const res = await fetch('/api/tools/execute', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...req, conversationId: convoId, messageId }),
            });
            if (!res.ok) {
              let detail = `Tool execution failed (${res.status})`;
              try {
                const body = (await res.json()) as { error?: string };
                if (body.error) detail = body.error;
              } catch {
                /* non-JSON error body */
              }
              throw new Error(detail);
            }
            const { artifact } = (await res.json()) as { artifact: Artifact };
            return artifact;
          }),
        );
        const artifacts = results
          .filter((r): r is PromiseFulfilledResult<Artifact> => r.status === 'fulfilled')
          .map((r) => r.value);
        if (artifacts.length > 0) {
          const msg = store
            .getState()
            .conversations.find((c) => c.id === convoId)
            ?.messages.find((m) => m.id === messageId);
          if (msg) {
            const existing = (msg.metadata?.artifacts as Artifact[]) ?? [];
            store.getState().updateMessage(convoId, messageId, {
              metadata: { ...msg.metadata, artifacts: [...existing, ...artifacts] },
            });
          }
        }

        // Every directive failed — the stripped content would otherwise be gone
        // for good. Restore the raw message so the user still sees the code, and
        // surface why (the failure is silent server-side otherwise).
        if (artifacts.length === 0) {
          store.getState().updateMessage(convoId, messageId, { content });
          const reason = results.find(
            (r): r is PromiseRejectedResult => r.status === 'rejected',
          )?.reason;
          const detail = reason instanceof Error ? reason.message : 'Tool execution failed.';
          toast(`Couldn't generate the file: ${detail}`, 'error');
        }
      } finally {
        // Must always clear, or a message that threw here can never retry.
        executingRef.current.delete(messageId);
      }
    },
    [store, toast],
  );

  /**
   * Detect codepatch directives in a completed message and resolve them against
   * the code the assistant wrote earlier in this conversation. Each fence is
   * rewritten in place to embed the fully-patched source, so PatchBlock can
   * render a diff + copyable corrected code without needing conversation
   * context, and it survives reload (content is persisted; metadata is not).
   */
  const processPatches = useCallback(
    (convoId: string, messageId: string, content: string) => {
      if (!content.includes('```codepatch')) return;
      const convo = store.getState().conversations.find((c) => c.id === convoId);
      if (!convo) return;

      // Candidate sources: code blocks from all *earlier* messages, newest
      // first, so a hunk resolves against the most recent version of the code.
      const idx = convo.messages.findIndex((m) => m.id === messageId);
      const priorCode: string[] = [];
      for (let i = idx - 1; i >= 0; i--) {
        for (const block of extractCodeBlocks(convo.messages[i]!.content)) {
          priorCode.push(block.code);
        }
      }

      const { content: enriched, applied } = enrichPatches(content, priorCode);
      if (applied && enriched !== content) {
        store.getState().updateMessage(convoId, messageId, { content: enriched });
      }
    },
    [store],
  );

  const stop = useCallback(() => {
    stopActiveGeneration();
  }, []);

  /** Core streaming routine: streams into an existing assistant message id. */
  const runStream = useCallback(
    async (
      convoId: string,
      assistantId: string,
      opts?: { append?: boolean; searchContext?: string },
    ) => {
      const s = store.getState();
      const convo = s.conversations.find((c) => c.id === convoId);
      if (!convo) return;
      if (!convo.model) {
        s.updateMessage(convoId, assistantId, {
          streaming: false,
          error: 'No model selected. Pick a model from the top bar.',
        });
        return;
      }

      const controller = new AbortController();
      // Abort any generation still in flight before taking over the single
      // slot — otherwise a stale controller keeps writing to the store and can
      // no longer be stopped (stopActiveGeneration only holds the latest one).
      activeController?.abort();
      activeController = controller;
      s.setGenerating(convoId);

      // History = everything up to (but not including) the assistant message,
      // unless we are continuing, in which case keep the partial assistant text.
      const idx = convo.messages.findIndex((m) => m.id === assistantId);
      const history = opts?.append
        ? convo.messages.slice(0, idx + 1)
        : convo.messages.slice(0, idx);

      const startedAt = Date.now();
      // Reuse the grounding captured on the first turn so regenerate/continue
      // don't silently answer without the web context the original answer had.
      const assistantMsg = convo.messages[idx];
      const searchContext =
        opts?.searchContext ?? (assistantMsg?.metadata?.searchContext as string | undefined);

      // Context compaction — before sending, if the estimated prompt exceeds a
      // fraction of the model's window, condense older turns into a running
      // summary so the model keeps the memory at a fraction of the token cost.
      // Failures here are non-fatal: we just send the full history as before.
      let summary = convo.summary;
      try {
        const plan = planCompaction(
          history,
          convo.systemPrompt,
          convo.params.contextLength,
          summary,
        );
        if (plan) {
          const text = await chat(
            {
              model: convo.model,
              messages: buildSummaryMessages(plan.toSummarize, summary),
              think: false, // the summary body must be clean prose, no reasoning tokens
            },
            controller.signal,
            // Summarizing a long transcript on a local model regularly takes
            // longer than the default 30s deadline. Timing out here silently
            // fell back to sending the full history, so the user waited 30s for
            // nothing and the context never actually got compacted.
            SUMMARY_TIMEOUT_MS,
          );
          if (text.trim()) {
            summary = {
              text: text.trim(),
              upToMessageId: plan.upToMessageId,
              createdAt: Date.now(),
              tokensAtSummary: estimateHistoryTokens(plan.toSummarize, ''),
            };
            store.getState().setConversationSummary(convoId, summary);
          }
        }

        // Even after compacting all it can, the prompt may still exceed the
        // hard window — this happens when the most recent messages that must
        // stay verbatim (e.g. a code paste bigger than num_ctx) are themselves
        // larger than the window. No summary can fix that, so warn the user
        // rather than let Ollama silently truncate. Fire at most once per
        // conversation until the situation clears, so it doesn't nag each turn.
        if (stillOverBudget(history, convo.systemPrompt, convo.params.contextLength, summary)) {
          if (overBudgetWarned.current !== convoId) {
            overBudgetWarned.current = convoId;
            toast(
              'This conversation is larger than the model’s context window. Raise Context Length in params, or split long code into smaller messages — older content may be dropped.',
              'error',
            );
          }
        } else if (overBudgetWarned.current === convoId) {
          overBudgetWarned.current = null;
        }
      } catch (err) {
        // Aborting the generation also aborts the summary request — propagate
        // that so we don't then fire a doomed stream; other errors are ignored.
        if (err instanceof ApiError && err.kind === 'aborted') {
          s.updateMessage(convoId, assistantId, { streaming: false });
          if (activeController === controller) {
            activeController = null;
            s.setGenerating(null);
          }
          return;
        }
      }

      // Build request — the effort level is sent verbatim as Ollama's `think`
      // parameter ("low" | "medium" | "high" | "max") when thinking is enabled.
      const options = toApiOptions(convo.params);
      const thinkingEnabled = convo.thinking?.enabled === true && providerSupportsThinking();

      // Stamp the effort level onto the message so the reasoning panel can react
      // to it (e.g. the "max" shimmer) and it survives a reload. Cleared when
      // thinking is off so a regenerate at a lower level doesn't keep a stale one.
      s.updateMessage(convoId, assistantId, {
        metadata: {
          ...assistantMsg?.metadata,
          effort: thinkingEnabled ? convo.thinking.effort : undefined,
        },
      });

      // Coalesce streamed tokens into a single store write per animation
      // frame. Upstream emits one delta per token; writing to the store per
      // token forces a full React re-render (and, via persist, a serialize)
      // thousands of times per response. Buffering to rAF caps that at the
      // display refresh rate while losing no content.
      let contentBuffer = '';
      let reasoningBuffer = '';
      let rafId: number | null = null;
      let firstToken = true;

      const flushBuffers = () => {
        rafId = null;
        if (contentBuffer) {
          store.getState().appendToMessage(convoId, assistantId, contentBuffer);
          contentBuffer = '';
        }
        if (reasoningBuffer) {
          store.getState().appendReasoning(convoId, assistantId, reasoningBuffer);
          reasoningBuffer = '';
        }
      };
      const scheduleFlush = () => {
        if (rafId === null) rafId = requestAnimationFrame(flushBuffers);
      };
      // Flush any buffered tokens immediately (stream end / abort / error) so
      // the final state is complete before we read it back.
      const flushNow = () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        flushBuffers();
      };

      try {
        await streamChat(
          {
            model: convo.model,
            messages: toApiMessages(history, convo.systemPrompt, searchContext, summary),
            options,
            ...(thinkingEnabled ? { think: convo.thinking.effort } : {}),
          },
          {
            onDelta: (delta) => {
              // First answer token ends the agentic-search phase display.
              if (firstToken) {
                firstToken = false;
                const m = store
                  .getState()
                  .conversations.find((c) => c.id === convoId)
                  ?.messages.find((mm) => mm.id === assistantId);
                if (m?.metadata?.searchPhase) {
                  store.getState().updateMessage(convoId, assistantId, {
                    metadata: { ...m.metadata, searchPhase: undefined, searching: false },
                  });
                }
              }
              contentBuffer += delta;
              scheduleFlush();
            },
            onThinking: (delta) => {
              reasoningBuffer += delta;
              scheduleFlush();
            },
            onDone: (final) => {
              flushNow();
              const finalContent =
                store
                  .getState()
                  .conversations.find((c) => c.id === convoId)
                  ?.messages.find((m) => m.id === assistantId)?.content ?? '';
              store.getState().updateMessage(convoId, assistantId, {
                streaming: false,
                metrics: metricsFromChunk(final, startedAt),
              });
              // Detect and execute artifact directives after streaming completes
              void processArtifacts(convoId, assistantId, finalContent);
              // Resolve any targeted code-patch directives against earlier code.
              processPatches(convoId, assistantId, finalContent);
            },
          },
          controller.signal,
        );
      } catch (err) {
        // Preserve whatever was buffered before the stream broke off.
        flushNow();
        const apiErr = ApiError.from(err);
        const cur = store
          .getState()
          .conversations.find((c) => c.id === convoId)
          ?.messages.find((m) => m.id === assistantId);
        if (apiErr.kind === 'aborted') {
          // Keep whatever was streamed; just mark it finished.
          store.getState().updateMessage(convoId, assistantId, {
            streaming: false,
            metrics: cur?.content ? { responseTimeMs: Date.now() - startedAt } : undefined,
          });
        } else {
          // If the model returned an error while thinking was enabled, it
          // likely doesn't support the `think` parameter. Mark it so the UI
          // can disable the toggle and show a tooltip.
          if (thinkingEnabled) {
            const msg = apiErr.message.toLowerCase();
            if (
              msg.includes('think') ||
              msg.includes('unsupported') ||
              msg.includes('unrecognized') ||
              msg.includes('unknown option') ||
              msg.includes('invalid') ||
              apiErr.status === 400
            ) {
              useThinkingStore.getState().markUnsupported(providerThinkingKey(convo.model));
            }
          }
          store.getState().updateMessage(convoId, assistantId, {
            streaming: false,
            error: apiErr.userMessage,
          });
        }
      } finally {
        // Only the generation that still owns the slot may release it. A newer
        // stream may already have taken over (regenerate while streaming, or a
        // fast second send) — clearing `generatingId` unconditionally killed the
        // stop button and typing indicator for a response still in flight.
        if (activeController === controller) {
          activeController = null;
          store.getState().setGenerating(null);
        }
      }
    },
    [store, processArtifacts, processPatches, toast],
  );

  /**
   * Agentic web search: plan → search → (return context for the reasoning turn).
   * Returns the formatted search context to feed the streaming answer, or
   * undefined when nothing usable came back. Updates `metadata.searchPhase` as
   * it moves through phases so the UI can show a multi-step indicator.
   *
   * When `thinkingEnabled` is false we skip the planning round-trip entirely and
   * search the raw user text — exactly the old behavior, so no regression.
   */
  const runAgenticSearch = useCallback(
    async (
      convoId: string,
      messageId: string,
      userText: string,
      history: Message[],
      model: string,
      thinkingEnabled: boolean,
    ): Promise<string | undefined> => {
      const setMeta = (patch: Record<string, unknown>) => {
        const msg = store
          .getState()
          .conversations.find((c) => c.id === convoId)
          ?.messages.find((m) => m.id === messageId);
        store
          .getState()
          .updateMessage(convoId, messageId, { metadata: { ...msg?.metadata, ...patch } });
      };

      // Phase 1 — plan the search. Only when thinking is on; otherwise fall back
      // to the raw query so weaker/non-thinking models keep working as before.
      let plan: SearchPlan;
      if (thinkingEnabled) {
        setMeta({ searching: true, searchPhase: 'planning' });
        try {
          const raw = await chat(
            {
              model,
              messages: buildPlanMessages(userText, history),
              think: false, // plan JSON must be clean — no reasoning tokens in the body
            },
            undefined,
            PLAN_TIMEOUT_MS,
          );
          plan = parsePlan(raw) ?? fallbackPlan(userText);
        } catch {
          plan = fallbackPlan(userText);
        }
      } else {
        plan = fallbackPlan(userText);
      }

      if (plan.queries.length === 0) {
        setMeta({ searching: false, searchPhase: undefined });
        return undefined;
      }

      // Phase 2 — run the planned queries and merge results.
      setMeta({
        searching: true,
        searchPhase: 'searching',
        plannedQueries: plan.queries,
        searchGoal: plan.goal,
      });
      const settled = await Promise.allSettled(plan.queries.map((q) => searchWeb(q)));
      const responses = settled
        .filter(
          (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof searchWeb>>> =>
            r.status === 'fulfilled',
        )
        .map((r) => r.value);

      if (responses.length === 0) {
        // Every query failed — surface the first rejection to the caller.
        const firstErr = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
        throw firstErr?.reason instanceof Error ? firstErr.reason : new Error('Web search failed');
      }

      const merged = mergeSearchResponses(responses);
      const context = formatSearchContext(merged);

      // Phase 3 — hand off to the reasoning turn. `analyzing` marks the moment
      // the model starts thinking over the gathered data (runStream takes over).
      setMeta({
        searching: false,
        searchPhase: 'analyzing',
        sources: toSources(merged),
        searchContext: context,
      });
      return context;
    },
    [store],
  );

  const send = useCallback(
    async (text: string, attachments: Attachment[] = [], webSearch = false) => {
      if (!conversationId) return;
      const trimmed = text.trim();
      if (!trimmed && attachments.length === 0) return;

      const s = store.getState();
      const convo = s.conversations.find((c) => c.id === conversationId);
      if (!convo) return;

      const userMsg: Message = {
        id: uid(),
        role: 'user',
        content: trimmed,
        createdAt: Date.now(),
        attachments: attachments.length ? attachments : undefined,
      };
      s.addMessage(conversationId, userMsg);

      // Auto-title on first user turn. Fall back to the first attachment's name
      // when the turn is attachment-only, so it doesn't stay "New chat" forever.
      if (convo.title === 'New chat' && convo.messages.length === 0) {
        const seed = trimmed || attachments[0]?.name || '';
        s.renameConversation(conversationId, deriveTitle(seed));
      }

      const assistantMsg: Message = {
        id: uid(),
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        model: convo.model,
        streaming: true,
      };
      s.addMessage(conversationId, assistantMsg);
      if (convo.model) s.pushRecentModel(convo.model);

      // Optional web search. When thinking is available, this is agentic: the
      // model first plans WHAT to search (keywords + goal), we run those
      // queries, then the streaming turn reasons over the results. A search
      // failure is non-fatal — we toast and let the model answer without it.
      let searchContext: string | undefined;
      if (webSearch && trimmed) {
        const thinkingEnabled =
          convo.thinking?.enabled === true && !!convo.model && providerSupportsThinking();
        try {
          searchContext = await runAgenticSearch(
            conversationId,
            assistantMsg.id,
            trimmed,
            convo.messages,
            convo.model,
            thinkingEnabled,
          );
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Web search failed', 'error');
          // Clear only the search keys — a bare object would also wipe `effort`
          // and anything else already stamped on this message.
          const msg = store
            .getState()
            .conversations.find((c) => c.id === conversationId)
            ?.messages.find((m) => m.id === assistantMsg.id);
          store.getState().updateMessage(conversationId, assistantMsg.id, {
            metadata: { ...msg?.metadata, searchPhase: undefined, searching: false },
          });
        }
      }

      await runStream(conversationId, assistantMsg.id, { searchContext });
    },
    [conversationId, runStream, runAgenticSearch, store, toast],
  );

  const regenerate = useCallback(
    async (assistantId: string) => {
      if (!conversationId) return;
      const s = store.getState();
      // Drop artifacts from the previous attempt — `processArtifacts` appends to
      // whatever is already there, so regenerating three times used to leave
      // three copies of the same file attached to one message. Everything else
      // in metadata (notably `searchContext`) has to survive, or the regenerated
      // answer silently loses the web grounding the original had.
      const prev = s.conversations
        .find((c) => c.id === conversationId)
        ?.messages.find((m) => m.id === assistantId);
      const metadata = prev?.metadata ? { ...prev.metadata } : undefined;
      if (metadata) delete metadata.artifacts;

      // Reset the assistant message content and re-stream. Clear reasoning too
      // so a regenerated response doesn't append onto the prior attempt's.
      s.updateMessage(conversationId, assistantId, {
        content: '',
        reasoning: undefined,
        error: undefined,
        streaming: true,
        metrics: undefined,
        metadata,
      });
      await runStream(conversationId, assistantId);
    },
    [conversationId, runStream, store],
  );

  const continueGeneration = useCallback(
    async (assistantId: string) => {
      if (!conversationId) return;
      store.getState().updateMessage(conversationId, assistantId, { streaming: true });
      await runStream(conversationId, assistantId, { append: true });
    },
    [conversationId, runStream, store],
  );

  /** Edit a user message: replace its content, drop later messages, re-ask. */
  const editUserMessage = useCallback(
    async (userMsgId: string, newContent: string) => {
      if (!conversationId) return;
      const s = store.getState();
      s.updateMessage(conversationId, userMsgId, { content: newContent.trim() });
      s.truncateFrom(conversationId, userMsgId, false); // keep the user msg, drop the rest

      const assistantMsg: Message = {
        id: uid(),
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        model: s.conversations.find((c) => c.id === conversationId)?.model,
        streaming: true,
      };
      s.addMessage(conversationId, assistantMsg);
      await runStream(conversationId, assistantMsg.id);
    },
    [conversationId, runStream, store],
  );

  return { send, stop, regenerate, continueGeneration, editUserMessage };
}
