/**
 * Row <-> domain mappers. Keep the DB shape (snake_case rows) isolated here so
 * the rest of the app only ever deals with the domain types in @/types.
 */

import type {
  Conversation,
  ConversationSummary,
  GenerationParams,
  Message,
  Role,
  ThinkingConfig,
  ThinkingEffort,
} from '@/types';
import { DEFAULT_PARAMS, DEFAULT_THINKING } from '@/lib/store/defaults';
import type { ArtifactKind, Artifact } from '@/lib/tools/types';
import type { ArtifactRow, ConversationRow, MessageRow } from '@/lib/supabase/types';

/**
 * `new Date(NaN).toISOString()` throws RangeError, which escaped through
 * saveConversation into the sync layer's empty catch — that conversation then
 * failed on every flush, forever, with no message anywhere. Reachable via an
 * imported chat file missing `createdAt`.
 */
const isoToMs = (iso: string): number => {
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : Date.now();
};
const msToIso = (ms: number): string =>
  new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString();

/** Keep only finite numbers — `metrics` is unchecked jsonb from the DB. */
function safeMetrics(raw: unknown): Message['metrics'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const src = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const out = {
    responseTimeMs: num(src.responseTimeMs),
    completionTokens: num(src.completionTokens),
    promptTokens: num(src.promptTokens),
    tokensPerSecond: num(src.tokensPerSecond),
  };
  return Object.values(out).some((v) => v !== undefined) ? out : undefined;
}

const EFFORTS: ThinkingEffort[] = ['low', 'medium', 'high', 'max'];

/** Coerce the `thinking` jsonb column into a valid ThinkingConfig. */
function safeThinking(raw: unknown): ThinkingConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_THINKING };
  const src = raw as Record<string, unknown>;
  return {
    enabled: src.enabled === true,
    effort: EFFORTS.includes(src.effort as ThinkingEffort)
      ? (src.effort as ThinkingEffort)
      : DEFAULT_THINKING.effort,
  };
}

/** Coerce the `summary` jsonb column; both string fields are required to be useful. */
function safeSummary(raw: unknown): ConversationSummary | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const src = raw as Record<string, unknown>;
  if (typeof src.text !== 'string' || !src.text.trim()) return undefined;
  if (typeof src.upToMessageId !== 'string' || !src.upToMessageId) return undefined;
  return {
    text: src.text,
    upToMessageId: src.upToMessageId,
    createdAt: typeof src.createdAt === 'number' ? src.createdAt : Date.now(),
    tokensAtSummary:
      typeof src.tokensAtSummary === 'number' ? src.tokensAtSummary : undefined,
  };
}

/**
 * `metadata` is a plain object or nothing — the column is jsonb, so it could
 * legitimately hold an array or a scalar, which the rest of the app would then
 * spread incorrectly.
 */
function safeMetadata(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out = raw as Record<string, unknown>;
  return Object.keys(out).length > 0 ? out : undefined;
}

export function rowToConversation(row: ConversationRow, messages: Message[]): Conversation {
  const rawParams = row.params && typeof row.params === 'object' ? row.params : {};
  const params = { ...DEFAULT_PARAMS, ...(rawParams as Partial<GenerationParams>) };
  return {
    id: row.id,
    title: row.title,
    messages,
    model: row.model,
    systemPrompt: row.system_prompt,
    params,
    thinking: safeThinking(row.thinking),
    summary: safeSummary(row.summary),
    pinned: row.pinned,
    createdAt: isoToMs(row.created_at),
    updatedAt: isoToMs(row.updated_at),
  };
}

export function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    role: row.role as Role,
    content: row.content,
    createdAt: isoToMs(row.created_at),
    model: row.model ?? undefined,
    // Validated rather than trusted: `metrics` is a jsonb column the row owner
    // can write anything into, and MessageBubble calls
    // `metrics.tokensPerSecond.toFixed(1)` — a string there took down the
    // message list.
    metrics: safeMetrics(row.metrics),
    reasoning: row.reasoning ?? undefined,
    // `artifacts` is deliberately absent here — the artifacts TABLE is the
    // source of truth and loadConversations merges it in afterwards. Persisting
    // it in metadata too would show every generated file twice.
    metadata: safeMetadata(row.metadata),
    error: row.error ?? undefined,
  };
}

/**
 * Map a persisted artifact row back to the domain Artifact shape used by the
 * UI. We deliberately do NOT set `url` here — signed URLs expire, so the URL is
 * minted fresh on display via /api/artifacts/refresh (see ArtifactPanel), which
 * only needs `bucket` + `storagePath`.
 */
export function rowToArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    conversationId: row.conversation_id ?? undefined,
    messageId: row.message_id ?? undefined,
    kind: row.kind as ArtifactKind,
    name: row.name,
    mimeType: row.mime_type ?? 'application/octet-stream',
    size: row.size_bytes,
    version: row.version,
    createdAt: isoToMs(row.created_at),
    bucket: row.bucket,
    storagePath: row.storage_path,
    ephemeral: false,
    metadata: (row.metadata as Record<string, unknown>) ?? undefined,
  };
}

export function conversationToRow(
  convo: Conversation,
  userId: string,
): Omit<ConversationRow, 'workspace_id' | 'folder' | 'favorite' | 'archived' | 'parent_id'> {
  return {
    id: convo.id,
    user_id: userId,
    title: convo.title,
    model: convo.model,
    system_prompt: convo.systemPrompt,
    params: convo.params,
    thinking: convo.thinking ?? DEFAULT_THINKING,
    summary: convo.summary ?? null,
    pinned: convo.pinned,
    created_at: msToIso(convo.createdAt),
    updated_at: msToIso(convo.updatedAt),
  };
}

export function messageToRow(
  msg: Message,
  convoId: string,
  userId: string,
  seq: number,
): Omit<MessageRow, 'updated_at' | 'parent_id'> {
  // Strip `artifacts`: they have their own table (written by /api/tools/execute)
  // and loadConversations re-attaches them, so keeping a copy here would show
  // every generated file twice.
  const { artifacts: _artifacts, ...metadata } = msg.metadata ?? {};
  return {
    id: msg.id,
    conversation_id: convoId,
    user_id: userId,
    role: msg.role,
    content: msg.content,
    model: msg.model ?? null,
    metrics: msg.metrics ?? null,
    error: msg.error ?? null,
    reasoning: msg.reasoning ?? null,
    metadata: Object.keys(metadata).length > 0 ? metadata : {},
    seq,
    created_at: msToIso(msg.createdAt),
  };
}
