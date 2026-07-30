/**
 * Row <-> domain mappers. Keep the DB shape (snake_case rows) isolated here so
 * the rest of the app only ever deals with the domain types in @/types.
 */

import type { Conversation, GenerationParams, Message, Role, ThinkingConfig } from '@/types';
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

export function rowToConversation(row: ConversationRow, messages: Message[]): Conversation {
  const rawParams = row.params && typeof row.params === 'object' ? row.params : {};
  const params = { ...DEFAULT_PARAMS, ...(rawParams as Partial<GenerationParams>) };
  // NOTE: `thinking` and `summary` have no columns yet, so both are lost on every
  // cloud round-trip (extended thinking silently reverts to off, and the
  // compaction summary is rebuilt from scratch). See
  // supabase/migrations/0005_sync_fidelity.sql — it is written but NOT applied,
  // because pushing it touches the live database.
  const thinking: ThinkingConfig = { ...DEFAULT_THINKING };
  return {
    id: row.id,
    title: row.title,
    messages,
    model: row.model,
    systemPrompt: row.system_prompt,
    params,
    thinking,
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
  return {
    id: msg.id,
    conversation_id: convoId,
    user_id: userId,
    role: msg.role,
    content: msg.content,
    model: msg.model ?? null,
    metrics: msg.metrics ?? null,
    error: msg.error ?? null,
    seq,
    created_at: msToIso(msg.createdAt),
  };
}
