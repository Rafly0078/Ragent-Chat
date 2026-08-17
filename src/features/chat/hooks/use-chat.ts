'use client';

import { useCallback, useRef } from 'react';
import type { Attachment, Message, SearchMode } from '@/types';
import { useChatStore, type PartDelta } from '@/lib/store/chat-store';
import { useSettings } from '@/lib/store/settings-store';
import { DEFAULT_SEARCH_MODE } from '@/lib/store/defaults';
import { useThinkingStore } from '@/lib/store/thinking-store';
import { resolveLimits, limitSourceLabel } from '@/features/models/resolve-limits';
import {
  ApiError,
  providerSupportsThinking,
  providerSupportsTools,
  providerThinkingKey,
} from '@/lib/api/config';
import { streamChat, chat } from '@/lib/api/client';
import {
  replayThinking,
  toApiMessages,
  toApiOptions,
  type ApiChatMessage,
  type ChatStreamChunk,
  type WireTool,
  type WireToolCall,
} from '@/lib/api/types';
import { uid } from '@/lib/utils/id';
import { detectArtifacts, hasCompleteDirective } from '@/lib/tools/detect';
import { enrichPatches, extractCodeBlocks } from '@/lib/tools/patch';
import { toolDefinitions } from '@/lib/tools/schemas';
import { getTool, isToolName, writesFile } from '@/lib/tools/registry';
import { getClientExecutor } from '@/lib/tools/client';
import type { Artifact, GenerateRequest } from '@/lib/tools/types';
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

/**
 * How many times the model may call tools and be handed the results within one
 * turn. Three covers "generate, see it failed, fix the arguments" and
 * "generate two files in sequence" without letting a confused model spin.
 */
const MAX_TOOL_STEPS = 3;

/** Tool definitions in wire shape. Stable, so it's computed once. */
let cachedWireTools: WireTool[] | null = null;
function wireTools(): WireTool[] {
  cachedWireTools ??= toolDefinitions().map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.schema as unknown as Record<string, unknown>,
  }));
  return cachedWireTools;
}

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

  /**
   * Mark a message as producing a file right now.
   *
   * Both artifact paths raise it — a directive in the finished content, and a tool
   * call mid-turn — because from the reader's side they are the same wait: the answer
   * has stopped and a file has not appeared yet. It is session state rather than
   * message data, for the reason `generatingFiles` gives in the store.
   */
  const markGenerating = useCallback(
    (messageId: string, on: boolean) => store.getState().setGeneratingFile(messageId, on),
    [store],
  );

  /** Detect artifact directives in a completed message and execute them. */
  const processArtifacts = useCallback(
    async (convoId: string, messageId: string, content: string) => {
      const { requests, cleaned } = detectArtifacts(content);
      if (requests.length === 0) return;
      // Avoid double-execution if already in progress
      if (executingRef.current.has(messageId)) return;
      executingRef.current.add(messageId);
      markGenerating(messageId, true);

      // The ordered `parts` are what the body actually renders once a message has
      // them; `content` is the flattened mirror. Stripping only the mirror left the
      // directive on screen — and a surviving fence is, by construction, one that
      // failed to parse, so `ArtifactDirectiveNotice` reported "File wasn't created"
      // beside a file that had just been created. Same strip, per text part; a part
      // that was nothing but the directive goes with it.
      const before = store
        .getState()
        .conversations.find((c) => c.id === convoId)
        ?.messages.find((m) => m.id === messageId)?.parts;
      const cleanedParts = before
        ?.map((part) =>
          part.kind === 'text' ? { ...part, text: detectArtifacts(part.text).cleaned } : part,
        )
        .filter((part) => part.kind !== 'text' || part.text !== '');

      try {
        // Strip artifact blocks from displayed content. Keep the original so we
        // can put it back if execution fails — otherwise a failed directive (e.g.
        // an unregistered tool) leaves a permanently blank message, since the
        // content was often ENTIRELY the artifact block ("return only the file").
        store
          .getState()
          .updateMessage(convoId, messageId, { content: cleaned, parts: cleanedParts });

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
        const failures = results
          .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
          .map((r) => (r.reason instanceof Error ? r.reason.message : 'Tool execution failed.'));

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

        if (failures.length === 0) return;

        if (artifacts.length === 0) {
          // Every directive failed — the stripped content would otherwise be gone
          // for good. Restore the raw message so the user still sees the code, and
          // surface why (the failure is silent server-side otherwise). Both the
          // ordered parts and the mirror, since the body renders the former.
          store.getState().updateMessage(convoId, messageId, { content, parts: before });
          toast(`Couldn't generate the file: ${failures[0]}`, 'error');
        } else {
          // PARTIAL failure. This branch didn't exist: the restore-and-toast was
          // gated on `artifacts.length === 0`, so 2 of 3 files failing produced
          // no toast, no notice, and the stripped directives were simply gone.
          // Restoring the raw content here would duplicate the files that DID
          // succeed, so say what was lost instead.
          const n = failures.length;
          toast(`${n} of ${results.length} files couldn't be generated: ${failures[0]}`, 'error');
        }
      } finally {
        // Must always clear, or a message that threw here can never retry — and the
        // mark has to come down on the failure path too, or a message that could not
        // produce its file would claim to be producing it forever.
        executingRef.current.delete(messageId);
        markGenerating(messageId, false);
      }
    },
    [store, toast, markGenerating],
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
        // The ordered parts too, not just the flattened mirror: they are what the
        // body renders, so enriching only `content` left PatchBlock reading the
        // original fence and rendering no diff. Same reason as the artifact strip
        // above. Per part, since a fence lives inside one text block.
        const parts = convo.messages[idx]?.parts?.map((part) =>
          part.kind === 'text'
            ? { ...part, text: enrichPatches(part.text, priorCode).content }
            : part,
        );
        store.getState().updateMessage(convoId, messageId, { content: enriched, parts });
      }
    },
    [store],
  );

  const stop = useCallback(() => {
    stopActiveGeneration();
  }, []);

  /**
   * Run the tools the model asked for, attach what they produced to the message,
   * and return one `tool` turn per call to hand back upstream.
   *
   * Failures are returned as tool results too, not swallowed. That is the whole
   * point of the loop: the executor's own message ("create_csv needs rows (an
   * array of arrays) or content") goes back to the model, which can then fix its
   * arguments. Previously an executor error reached the user as a toast and the
   * model learned nothing, so a regenerate re-ran the same broken call.
   */
  const executeToolCalls = useCallback(
    async (
      convoId: string,
      messageId: string,
      calls: WireToolCall[],
    ): Promise<ApiChatMessage[]> => {
      // Only the calls that end in a file. `fetch_url` and `run_js` arrive here too,
      // and a mark reading GENERATING over a page fetch states something untrue.
      const writing = calls.some((call) => writesFile(call.name));
      if (writing) markGenerating(messageId, true);
      try {
        const settled = await Promise.allSettled(
          calls.map(async (call): Promise<{ artifact?: Artifact; text?: string }> => {
            const request = {
              ...call.arguments,
              tool: call.name,
              conversationId: convoId,
              messageId,
            };

            // Client-side tools never touch the network. `run_js` is the reason
            // `ToolMeta.server` exists as a discriminator rather than documentation:
            // running model-authored code on the server would be arbitrary RCE, so
            // it runs in an origin-isolated iframe in this tab instead.
            if (isToolName(call.name) && getTool(call.name)?.server === false) {
              const exec = await getClientExecutor(call.name);
              if (!exec) throw new Error(`No client executor for "${call.name}".`);
              return exec(request as GenerateRequest);
            }

            const res = await fetch('/api/tools/execute', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(request),
            });
            if (!res.ok) {
              let detail = `Tool execution failed (${res.status}).`;
              try {
                const body = (await res.json()) as { error?: string };
                if (body.error) detail = body.error;
              } catch {
                /* non-JSON error body */
              }
              throw new Error(detail);
            }
            // Two result shapes: a generated file, or text for the model (a read
            // tool such as `fetch_url`).
            return (await res.json()) as { artifact?: Artifact; text?: string };
          }),
        );

        const produced: Artifact[] = [];
        const turns: ApiChatMessage[] = [];
        settled.forEach((result, i) => {
          const call = calls[i]!;
          if (result.status === 'fulfilled') {
            const { artifact, text } = result.value;
            if (artifact) {
              produced.push(artifact);
              turns.push({
                role: 'tool',
                toolCallId: call.id,
                // The id is here so `edit_artifact` is reachable at all — without
                // it the model has no handle on what it just produced and can only
                // regenerate the whole document.
                content:
                  `Created "${artifact.name}" (${artifact.mimeType}, ${artifact.size} bytes, ` +
                  `id ${artifact.id}, version ${artifact.version}). It is attached to this ` +
                  `message and downloadable by the user — do not repeat its contents in your ` +
                  `reply. To change it later, call edit_artifact with that id rather than ` +
                  `generating it again.`,
              });
              return;
            }
            turns.push({
              role: 'tool',
              toolCallId: call.id,
              content: text ?? '(the tool returned nothing)',
            });
            return;
          }
          const message =
            result.reason instanceof Error ? result.reason.message : 'Tool execution failed.';
          turns.push({
            role: 'tool',
            toolCallId: call.id,
            toolError: true,
            content: `Error: ${message}`,
          });
        });

        if (produced.length > 0) {
          const msg = store
            .getState()
            .conversations.find((c) => c.id === convoId)
            ?.messages.find((m) => m.id === messageId);
          if (msg) {
            const existing = (msg.metadata?.artifacts as Artifact[]) ?? [];
            store.getState().updateMessage(convoId, messageId, {
              metadata: { ...msg.metadata, artifacts: [...existing, ...produced] },
            });
          }
        }
        return turns;
      } finally {
        // In a `finally` for the same reason the directive path's clear is: this
        // throwing anywhere above would otherwise leave the message saying a file
        // was coming, with nothing left running to say otherwise.
        if (writing) markGenerating(messageId, false);
      }
    },
    [store, markGenerating],
  );

  /** Core streaming routine: streams into an existing assistant message id. */
  const runStream = useCallback(
    async (
      convoId: string,
      assistantId: string,
      opts?: {
        append?: boolean;
        searchContext?: string;
        /**
         * Extra turns appended after the conversation history — the assistant's
         * own tool requests and their results, on a follow-up pass of the native
         * tool-calling loop. Carried here rather than written into the store so a
         * tool round trip doesn't add visible messages to the transcript.
         */
        extraTurns?: ApiChatMessage[];
        /** Which pass of the tool loop this is; bounded by MAX_TOOL_STEPS. */
        toolStep?: number;
      },
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

      // Context window / output ceiling. With auto on (the default) these follow
      // the active model instead of the stored slider values, so compaction
      // budgets against the window we are actually going to send.
      const limits = resolveLimits(convo.params, convo.model);
      const params = {
        ...convo.params,
        contextLength: limits.contextLength,
        maxTokens: limits.maxTokens,
      };

      // Context compaction — before sending, if the estimated prompt exceeds a
      // fraction of the model's window, condense older turns into a running
      // summary so the model keeps the memory at a fraction of the token cost.
      // Failures here are non-fatal: we just send the full history as before.
      let summary = convo.summary;
      try {
        const plan = planCompaction(history, convo.systemPrompt, params.contextLength, summary);
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
        if (stillOverBudget(history, convo.systemPrompt, params.contextLength, summary)) {
          if (overBudgetWarned.current !== convoId) {
            overBudgetWarned.current = convoId;
            toast(
              `This conversation is larger than the ${limits.contextLength.toLocaleString()}-token context window (${limitSourceLabel(limits.contextSource)}). Split long code into smaller messages, or set Context Length manually in params — older content may be dropped.`,
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
      const options = toApiOptions(params);
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

      // Coalesce streamed segments into a single store write per animation
      // frame. Upstream emits one delta per token; writing to the store per
      // token forces a full React re-render (and, via persist, a serialize)
      // thousands of times per response. Buffering to rAF caps that at the
      // display refresh rate while losing no content.
      //
      // ONE ordered queue, not a `contentBuffer` and a `reasoningBuffer`. Two
      // parallel scalars flushed in a fixed order could not represent
      // think → answer → think: within a single frame the interleaving was
      // already gone, and the store then concatenated each into one flat string.
      let pending: PartDelta[] = [];
      let rafId: number | null = null;
      let firstToken = true;

      const flushBuffers = () => {
        rafId = null;
        if (pending.length === 0) return;
        const batch = pending;
        pending = [];
        store.getState().appendParts(convoId, assistantId, batch);
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

      // Native function calling, where the provider supports it. The text
      // directive in TOOL_INSTRUCTIONS stays in the prompt as the fallback for
      // Ollama and for models that ignore the tools array.
      const toolStep = opts?.toolStep ?? 0;
      const nativeTools = providerSupportsTools() && toolStep < MAX_TOOL_STEPS;
      /** Tool calls collected during this pass, executed once the stream ends. */
      const requestedCalls: WireToolCall[] = [];
      /** Whether this pass raised the file-writing mark, so it can release it once. */
      let announcedFile = false;

      try {
        await streamChat(
          {
            model: convo.model,
            messages: [
              ...toApiMessages(history, convo.systemPrompt, searchContext, summary, nativeTools),
              ...(opts?.extraTurns ?? []),
            ],
            options,
            ...(thinkingEnabled ? { think: convo.thinking.effort } : {}),
            ...(nativeTools ? { tools: wireTools() } : {}),
          },
          {
            onToolCalls: (calls) => {
              requestedCalls.push(...calls);
            },
            // The model has started dictating a file — its arguments are still
            // arriving, which is the longest part of the wait. Raised here rather than
            // at execution, which is where the mark used to appear: by then the file
            // has been written and only the upload is left. Once per pass, so the
            // release in `finally` balances it however many calls announce themselves.
            onToolCallStart: (name) => {
              if (announcedFile || !writesFile(name)) return;
              announcedFile = true;
              markGenerating(assistantId, true);
            },
            onPart: (part) => {
              // The first token of EITHER stream ends the agentic-search phase
              // display. It used to fire only on content, so a thinking model
              // sat under "Searching…" for the whole reasoning block.
              if (firstToken && part.text) {
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
              pending.push({
                kind: part.kind,
                index: part.index,
                text: part.text,
                ...(part.done ? { done: true } : {}),
                ...(part.signature ? { signature: part.signature } : {}),
                ...(part.redacted ? { redacted: true } : {}),
              });
              scheduleFlush();
            },
            onDone: (final) => {
              flushNow();
              // Close a thinking block the provider never explicitly ended, so
              // no panel is left reading "Thinking…" on a finished message.
              store.getState().sealParts(convoId, assistantId);
              const finalContent =
                store
                  .getState()
                  .conversations.find((c) => c.id === convoId)
                  ?.messages.find((m) => m.id === assistantId)?.content ?? '';
              // The model asked for tools. Keep the message streaming, run them,
              // hand the results back, and let it continue — the loop lives in
              // the `finally` below so it runs after this handler returns.
              if (requestedCalls.length > 0) {
                store.getState().updateMessage(convoId, assistantId, {
                  metrics: metricsFromChunk(final, startedAt),
                });
                return;
              }
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
        // Preserve whatever was buffered before the stream broke off, then close
        // the open thinking block AS INTERRUPTED so the panel can say it was cut
        // off rather than leaving it reading "Thinking…" forever.
        flushNow();
        store.getState().sealParts(convoId, assistantId, true);
        const apiErr = ApiError.from(err);
        const cur = store
          .getState()
          .conversations.find((c) => c.id === convoId)
          ?.messages.find((m) => m.id === assistantId);
        if (apiErr.kind === 'aborted') {
          // Keep whatever was streamed; just mark it finished. Timing counts
          // when EITHER stream produced something: stopping part-way through a
          // long reasoning block is still work the user waited for, and gating
          // this on `content` alone left a thinking-only stop with no metrics
          // and no visible affordance at all.
          const produced = Boolean(cur?.content) || Boolean(cur?.reasoning);
          store.getState().updateMessage(convoId, assistantId, {
            streaming: false,
            metrics: produced ? { responseTimeMs: Date.now() - startedAt } : undefined,
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

        // A directive that finished before the stream broke off is still a valid
        // directive. This path never ran detection at all, so stopping a
        // generation right after the model closed its ```artifact fence threw the
        // whole file away — `hasCompleteDirective` existed for exactly this and
        // was never called from anywhere.
        const partial = cur?.content ?? '';
        if (partial && hasCompleteDirective(partial)) {
          void processArtifacts(convoId, assistantId, partial);
        }
        // A failed pass ends the loop; don't run the tools it asked for.
        requestedCalls.length = 0;
      } finally {
        // Only the generation that still owns the slot may release it. A newer
        // stream may already have taken over (regenerate while streaming, or a
        // fast second send) — clearing `generatingId` unconditionally killed the
        // stop button and typing indicator for a response still in flight.
        if (activeController === controller) {
          activeController = null;
          store.getState().setGenerating(null);
        }
        // The claim raised by `onToolCallStart` belongs to this pass, so this pass
        // releases it — every way it can end, including an abort, an error, or a model
        // that announced a call and then changed its mind. It is a count, so releasing
        // here cannot take down the claim the directive path is still holding, and
        // `executeToolCalls` raises its own below with no await in between.
        if (announcedFile) markGenerating(assistantId, false);
      }

      // The agentic step. Outside the try/finally above so the controller for
      // this pass is already released — the recursive call installs its own.
      //
      // This is the loop the tool system never had: tools used to run exactly
      // once, after the full response, with the result visible only to the user.
      // The model could not see what it produced, could not repair a failure, and
      // could not chain two calls. Bounded by MAX_TOOL_STEPS so a model that
      // keeps asking can't spin.
      if (requestedCalls.length > 0 && !controller.signal.aborted) {
        // Hold the generating flag across the tool round trip. The `finally` above
        // released it, and executing a tool is a network call — without this the
        // stop button and typing indicator would blink off while the message is
        // still, correctly, marked `streaming`.
        store.getState().setGenerating(convoId);
        const results = await executeToolCalls(convoId, assistantId, requestedCalls);
        const assistantSoFar = store
          .getState()
          .conversations.find((c) => c.id === convoId)
          ?.messages.find((m) => m.id === assistantId);
        const replayedThinking = replayThinking(assistantSoFar?.parts);
        const nextTurns: ApiChatMessage[] = [
          ...(opts?.extraTurns ?? []),
          // The assistant turn that made the requests. Required: a tool result
          // referencing a call the model never sees is rejected by both APIs.
          //
          // Its reasoning goes back with it. A DeepSeek-style gateway rejects the
          // follow-up otherwise ("the `reasoning_content` in the thinking mode must be
          // passed back"), which meant a thinking model that generated files ended the
          // turn on a 400 — with the files already written and nothing to show for it.
          // Anthropic wants the same thing in its own form: signed blocks, or it
          // refuses to continue an interleaved-thinking turn at all.
          {
            role: 'assistant',
            content: assistantSoFar?.content ?? '',
            toolCalls: requestedCalls,
            ...(assistantSoFar?.reasoning ? { reasoning: assistantSoFar.reasoning } : {}),
            ...(replayedThinking.length ? { thinking: replayedThinking } : {}),
          },
          ...results,
        ];
        await runStream(convoId, assistantId, {
          append: true,
          searchContext,
          extraTurns: nextTurns,
          toolStep: toolStep + 1,
        });
      }
    },
    [store, processArtifacts, processPatches, executeToolCalls, markGenerating, toast],
  );

  /**
   * Agentic web search: plan → search → (return context for the reasoning turn).
   * Returns the formatted search context to feed the streaming answer, or
   * undefined when nothing usable came back. Updates `metadata.searchPhase` as
   * it moves through phases so the UI can show a multi-step indicator.
   *
   * `mode` decides how much authority the planner has:
   *
   *   always  search no matter what; a planner failure falls back to searching
   *           the raw user text, which is the pre-planner behavior.
   *   auto    the planner ALSO decides whether the web is needed at all. A
   *           failure here means no search — guessing "yes" would spend a search
   *           quota (and add latency) on every turn a flaky model can't answer.
   *
   * The planning call itself runs with `think: false` regardless of the
   * conversation's thinking setting, so it works on models without a reasoning
   * parameter too.
   */
  const runAgenticSearch = useCallback(
    async (
      convoId: string,
      messageId: string,
      userText: string,
      history: Message[],
      model: string,
      mode: 'auto' | 'always',
      /**
       * Abort signal for the whole search phase.
       *
       * Previously absent: the planning call was passed `undefined` and
       * `searchWeb` no signal at all, so pressing Stop while "Searching…" was on
       * screen cancelled nothing. The planner round trip and every Tavily query
       * ran to completion, and `send` then fell through and started a brand-new
       * generation the user had just asked to stop.
       */
      signal: AbortSignal,
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

      // Phase 1 — plan the search. In auto mode this same call decides IF we
      // search, so deciding and planning cost one round-trip, not two.
      let plan: SearchPlan | null = null;
      setMeta({ searching: true, searchPhase: mode === 'auto' ? 'deciding' : 'planning' });
      try {
        const raw = await chat(
          {
            model,
            messages: buildPlanMessages(userText, history, mode),
            think: false, // plan JSON must be clean — no reasoning tokens in the body
          },
          signal,
          PLAN_TIMEOUT_MS,
        );
        plan = parsePlan(raw);
      } catch (err) {
        // An abort has to propagate: treating it as "no plan" let `always` mode
        // fall through to searching the raw text after the user pressed Stop.
        if (err instanceof ApiError && err.kind === 'aborted') throw err;
        plan = null;
      }

      // The planner declined: answer from the model's own knowledge. Keep the
      // reason so the UI can say why no sources are attached.
      if (plan?.needsSearch === false) {
        setMeta({
          searching: false,
          searchPhase: undefined,
          searchSkipped: true,
          searchSkipReason: plan.reason || undefined,
        });
        return undefined;
      }

      if (!plan) {
        // No usable plan. In `always` the user asked for a search, so search the
        // raw text; in `auto` an unparseable plan is not consent to search.
        if (mode === 'auto') {
          setMeta({ searching: false, searchPhase: undefined, searchSkipped: true });
          return undefined;
        }
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
      const settled = await Promise.allSettled(plan.queries.map((q) => searchWeb(q, signal)));
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

      // The provider answered but nothing in it was usable. `formatSearchContext`
      // returns '' for that now, rather than a "cite as [1], [2]" header with no
      // results under it — so there is nothing to give the model and nothing to
      // cite, and stamping `analyzing` with an empty source list would show a
      // finished search that had found something.
      if (!context) {
        setMeta({ searching: false, searchPhase: undefined });
        return '';
      }

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
    async (text: string, attachments: Attachment[] = [], searchMode?: SearchMode) => {
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

      // Web search. `off` skips it entirely; `always` searches every turn;
      // `auto` lets the planner decide per turn whether the web is needed. The
      // caller's mode wins so the composer control is authoritative for this
      // send; otherwise fall back to the conversation's, then the global default.
      // A search failure is non-fatal — we toast and answer without it.
      const mode: SearchMode =
        searchMode ??
        convo.searchMode ??
        useSettings.getState().defaultSearchMode ??
        DEFAULT_SEARCH_MODE;

      let searchContext: string | undefined;
      if (mode !== 'off' && trimmed && convo.model) {
        // The search phase gets its own controller, published as the active one
        // so the Stop button and Esc reach it. Without this the whole phase was
        // uncancellable, and a Stop during "Searching…" was followed by a fresh
        // generation starting anyway.
        const searchController = new AbortController();
        activeController?.abort();
        activeController = searchController;
        s.setGenerating(conversationId);
        try {
          searchContext = await runAgenticSearch(
            conversationId,
            assistantMsg.id,
            trimmed,
            convo.messages,
            convo.model,
            mode,
            searchController.signal,
          );
        } catch (err) {
          const aborted =
            (err instanceof ApiError && err.kind === 'aborted') || searchController.signal.aborted;
          // Clear only the search keys — a bare object would also wipe `effort`
          // and anything else already stamped on this message.
          const msg = store
            .getState()
            .conversations.find((c) => c.id === conversationId)
            ?.messages.find((m) => m.id === assistantMsg.id);
          store.getState().updateMessage(conversationId, assistantMsg.id, {
            metadata: { ...msg?.metadata, searchPhase: undefined, searching: false },
            ...(aborted ? { streaming: false } : {}),
          });
          if (aborted) {
            // Stopped during search: don't then start the generation they stopped.
            if (activeController === searchController) {
              activeController = null;
              store.getState().setGenerating(null);
            }
            return;
          }
          toast(err instanceof Error ? err.message : 'Web search failed', 'error');
        } finally {
          // runStream installs its own controller; release this one either way so
          // it can't abort the generation that follows.
          if (activeController === searchController) activeController = null;
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

      // Reset the assistant message and re-stream. `parts` has to be cleared
      // alongside `content`/`reasoning` — it is now the ordered truth those two
      // are derived from, so leaving it would have the regenerated answer append
      // onto the previous attempt's blocks.
      s.updateMessage(conversationId, assistantId, {
        content: '',
        parts: undefined,
        reasoning: undefined,
        reasoningTimeMs: undefined,
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
      // Seal the previous turn's trailing thinking block before re-streaming.
      // Without this, a continue appended the new turn's reasoning seamlessly
      // onto the old block — the two turns' thinking silently became one.
      // Ordered parts make the second turn's blocks land after the first turn's
      // text, which is what actually happened.
      store.getState().sealParts(conversationId, assistantId);
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
