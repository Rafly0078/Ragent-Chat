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
  /** The model's extended-thinking output, streamed separately from content. */
  reasoning?: string;
  /** Wall-clock time spent in the reasoning phase, ms (set once thinking ends). */
  reasoningTimeMs?: number;
  /** Set when generation failed, holds a user-facing message. */
  error?: string;
  /** Arbitrary metadata — used by the tool engine to attach artifacts, etc. */
  metadata?: Record<string, unknown>;
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
