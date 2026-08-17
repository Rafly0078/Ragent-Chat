/**
 * Shared domain types for the whole app. Kept framework-agnostic so both the
 * API layer and the UI can depend on them without circular imports.
 */

export type Role = 'system' | 'user' | 'assistant';

/**
 * Effort level for extended thinking. These values are sent verbatim as the
 * Ollama `think` parameter, which accepts "low" | "medium" | "high" | "max".
 */
export type ThinkingEffort = 'low' | 'medium' | 'high' | 'max';

/** Per-conversation thinking configuration. */
export interface ThinkingConfig {
  enabled: boolean;
  effort: ThinkingEffort;
}

/**
 * How web search is applied to a turn.
 *
 *   off     never search
 *   auto    ask the planner first; it may decide no search is needed
 *   always  search every turn (the old on/off toggle's "on")
 */
export type SearchMode = 'off' | 'auto' | 'always';

/** Ordered for the tri-state control in the composer. */
export const SEARCH_MODES: SearchMode[] = ['off', 'auto', 'always'];

export interface Attachment {
  id: string;
  /** Original filename. */
  name: string;
  /** MIME type, e.g. image/png, application/pdf, text/plain. */
  type: string;
  size: number;
  /** For images: base64 (no data-url prefix) sent to vision models. */
  base64?: string;
  /** For text/pdf: extracted text content inlined into the prompt. */
  text?: string;
  /** Object URL / data URL for local preview only. */
  previewUrl?: string;
}

export interface MessageMetrics {
  /** Wall-clock time from request start to completion, ms. */
  responseTimeMs?: number;
  /** Tokens produced by the model for this response. */
  completionTokens?: number;
  /** Tokens in the prompt. */
  promptTokens?: number;
  /** Tokens per second during generation. */
  tokensPerSecond?: number;
}

/**
 * One ordered segment of an assistant message.
 *
 * This is what makes interleaved thinking possible. Reasoning used to be a
 * single flat `reasoning` string appended to on every thinking delta, so a model
 * that went think → answer → think again produced one blob of all thinking and
 * one blob of all text, with the ordering between them unrecoverable. A message
 * is now an ordered list: the renderer walks it and emits a reasoning panel or a
 * markdown segment per entry, in the order the model actually produced them.
 *
 * `index` is the upstream content-block index where the provider gives one
 * (Anthropic), or a synthesized counter where it doesn't (OpenAI-compatible,
 * Ollama) — see `providerStream`. It exists so deltas arriving out of order, or
 * a resumed block, land in the right part instead of opening a new one.
 */
export type MessagePart =
  | { kind: 'text'; index: number; text: string }
  | {
      kind: 'thinking';
      index: number;
      text: string;
      /** Epoch ms when the first delta for this block arrived. */
      startedAt: number;
      /** Set when the block closes; absent while it is still streaming. */
      endedAt?: number;
      /**
       * Anthropic's opaque signature for the block. Must be echoed back
       * verbatim alongside the thinking text on later turns or the API rejects
       * the request — see `toApiMessages`.
       */
      signature?: string;
      /** Anthropic returned this block encrypted; there is no text to show. */
      redacted?: boolean;
      /** The stream ended before this block closed (abort, error, timeout). */
      interrupted?: boolean;
    };

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  /** Present on assistant messages once generation finishes. */
  metrics?: MessageMetrics;
  attachments?: Attachment[];
  /** Model that produced an assistant message (for display). */
  model?: string;
  /** True while the message is actively streaming. */
  streaming?: boolean;
  /**
   * Ordered text/thinking segments — the real shape of an assistant message.
   *
   * `content` and `reasoning` below remain the flattened mirrors of this, kept
   * in sync by the store, because a great deal reads them: `toApiMessages`,
   * artifact/patch detection, compaction, export, search-source extraction and
   * every message persisted before this existed. Absent on user messages and on
   * assistant messages from older sessions, so readers must fall back.
   */
  parts?: MessagePart[];
  /** All thinking text concatenated. Derived mirror of `parts`; see above. */
  reasoning?: string;
  /** Wall-clock time spent thinking, ms — summed across every thinking part. */
  reasoningTimeMs?: number;
  /** Set when generation failed, holds a user-facing message. */
  error?: string;
  /** Arbitrary metadata — used by the tool engine to attach artifacts, etc. */
  metadata?: Record<string, unknown>;
}

/**
 * Flatten ordered parts back into the `content` / `reasoning` mirrors.
 *
 * One place, so the store, the Supabase mapper and the migration cannot drift
 * on what "the text of this message" means.
 *
 * A redacted block contributes its duration but not its text: what it holds is
 * the provider's opaque payload, kept on the part so the next turn can replay it
 * verbatim. Folded into `reasoning` it would go back upstream as
 * `reasoning_content` — and into every export and copy of the message — as a
 * wall of base64.
 */
export function flattenParts(parts: MessagePart[]): {
  content: string;
  reasoning: string;
  reasoningTimeMs?: number;
} {
  let content = '';
  let reasoning = '';
  let reasoningTimeMs = 0;
  let sawTiming = false;
  for (const p of parts) {
    if (p.kind === 'text') {
      content += p.text;
      continue;
    }
    reasoning += p.redacted === true ? '' : p.text;
    if (p.endedAt !== undefined) {
      reasoningTimeMs += p.endedAt - p.startedAt;
      sawTiming = true;
    }
  }
  return { content, reasoning, ...(sawTiming ? { reasoningTimeMs } : {}) };
}

/** Per-conversation generation parameters. Falls back to global settings. */
export interface GenerationParams {
  temperature: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
  /** Ollama `num_ctx` — context window length. */
  contextLength: number;
  /** Ollama `num_predict` — max tokens to generate. -1 = unlimited. */
  maxTokens: number;
  /**
   * Follow the active model/provider's own context window instead of
   * `contextLength`. Stays true until the user drags the slider, at which point
   * their number wins for good (see `resolveLimits`).
   */
  contextAuto?: boolean;
  /** Same deal for `maxTokens` — track the model's output ceiling. */
  maxTokensAuto?: boolean;
}

/**
 * A compacted memory of earlier turns. `text` is the model-written summary;
 * `upToMessageId` marks the last message folded into it, so only messages
 * created after it are still sent verbatim. `tokensAtSummary` records the
 * estimated size of the compacted span (for debugging / the UI).
 */
export interface ConversationSummary {
  text: string;
  upToMessageId: string;
  createdAt: number;
  tokensAtSummary?: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  model: string;
  systemPrompt: string;
  params: GenerationParams;
  /** Extended thinking configuration (Ollama `think` parameter). */
  thinking: ThinkingConfig;
  /**
   * Web-search mode for this conversation. Optional so conversations created
   * before this existed keep working; the reader defaults them to the global
   * setting rather than silently turning search off.
   */
  searchMode?: SearchMode;
  /**
   * Running summary of the messages that have been compacted out of the live
   * context to keep long conversations within the model's window. Injected as a
   * system message and refreshed as the chat grows. Absent until the first
   * compaction happens.
   */
  summary?: ConversationSummary;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface OllamaModelDetails {
  family?: string;
  parameterSize?: string;
  quantizationLevel?: string;
  format?: string;
}

export interface ModelInfo {
  /** Unique model id / tag, e.g. "llama3.2:latest". */
  name: string;
  /** Human label. Owner-curated display name when set, else derived from name. */
  label: string;
  /** True when `label` comes from an owner-curated override (not the raw name). */
  customLabel?: boolean;
  /** Owner-hidden: kept in the list but shown only to the owner, who can un-hide it. */
  hidden?: boolean;
  /** Optional owner-authored description shown in the picker. */
  description?: string;
  /** Size on disk in bytes. */
  size?: number;
  /** Context length in tokens if known (from /api/show or a `/models` entry). */
  contextLength?: number;
  /** Output-token ceiling when the endpoint reports one. */
  maxOutputTokens?: number;
  details: OllamaModelDetails;
  /** Whether the model accepts images (vision). */
  supportsVision?: boolean;
}

export interface PromptPreset {
  id: string;
  name: string;
  content: string;
}

export interface SlashCommand {
  command: string;
  description: string;
  /** Text inserted / action performed. */
  template?: string;
}
