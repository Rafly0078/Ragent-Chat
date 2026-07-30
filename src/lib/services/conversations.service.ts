'use client';

/**
 * Conversation persistence. The store's unit of work is a whole Conversation
 * (with its messages), so this service mirrors that: load all, upsert one
 * (conversation row + replace its messages), and delete. UI/stores call this —
 * never Supabase directly — so the backend stays replaceable.
 *
 * All calls run as the signed-in user under RLS. When Supabase isn't
 * configured, methods no-op / return empty so guest mode keeps working.
 */

import type { Conversation, Message } from '@/types';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import {
  conversationToRow,
  messageToRow,
  rowToArtifact,
  rowToConversation,
  rowToMessage,
} from './mappers';
import type { ArtifactRow, ConversationRow, MessageRow } from '@/lib/supabase/types';
import type { Artifact } from '@/lib/tools/types';

/** PostgREST caps a response at the project's max-rows (1000 by default). */
const PAGE_SIZE = 1000;

/**
 * Read every row matching a filter, page by page.
 *
 * `loadConversations` used to fetch messages with a single unpaginated
 * `.select('*').in(...)`, so past 1000 rows it returned a PARTIAL message set —
 * which then replaced the store, and the next `saveConversation` deleted every
 * remote message that wasn't in the truncated list. The read silently caused
 * permanent data loss.
 */
async function selectAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; ; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

/** Load every conversation for the current user, newest first, with messages. */
export async function loadConversations(): Promise<Conversation[]> {
  const supabase = getSupabaseBrowser();
  if (!supabase) return [];

  const convoRows = await selectAllPages<ConversationRow>((from, to) =>
    supabase
      .from('conversations')
      .select('*')
      .order('updated_at', { ascending: false })
      .range(from, to),
  );
  if (convoRows.length === 0) return [];

  const ids = convoRows.map((c) => c.id);

  // Messages and artifacts are independent — fetch them in parallel to cut
  // the total round-trips.
  const [msgRows, artifactRows] = await Promise.all([
    selectAllPages<MessageRow>((from, to) =>
      supabase
        .from('messages')
        .select('*')
        .in('conversation_id', ids)
        .order('seq', { ascending: true })
        // Tiebreakers: `seq` has no unique constraint, and equal sort keys come
        // back in arbitrary order in Postgres — messages could interleave.
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    ),
    selectAllPages<ArtifactRow>((from, to) =>
      supabase
        .from('artifacts')
        .select('*')
        .in('conversation_id', ids)
        .order('created_at', { ascending: true })
        .range(from, to),
    ),
  ]);

  const byConvo = new Map<string, Message[]>();
  for (const row of msgRows) {
    const list = byConvo.get(row.conversation_id) ?? [];
    list.push(rowToMessage(row));
    byConvo.set(row.conversation_id, list);
  }

  // Artifacts (generated PDF/DOCX/… files) live in their own table, linked by
  // message_id. They are NOT stored on the message row, so without this step a
  // reloaded conversation shows its text but drops every generated file. Fetch
  // them and re-attach to the owning message's metadata — exactly where the
  // tool engine puts them at generation time (see use-chat.ts processArtifacts).
  const artifactsByMessage = new Map<string, Artifact[]>();
  // Legacy/orphaned artifacts: earlier versions of saveConversation deleted &
  // re-inserted messages on every sync, which nulled artifacts.message_id via
  // the FK's `on delete set null`. Those files still have a conversation_id, so
  // recover them by attaching to that conversation's last assistant message.
  const orphansByConvo = new Map<string, Artifact[]>();
  for (const row of artifactRows) {
    const artifact = rowToArtifact(row);
    if (row.message_id) {
      const list = artifactsByMessage.get(row.message_id) ?? [];
      list.push(artifact);
      artifactsByMessage.set(row.message_id, list);
    } else if (row.conversation_id) {
      const list = orphansByConvo.get(row.conversation_id) ?? [];
      list.push(artifact);
      orphansByConvo.set(row.conversation_id, list);
    }
  }
  if (artifactsByMessage.size > 0 || orphansByConvo.size > 0) {
    for (const [convoId, messages] of byConvo.entries()) {
      for (const msg of messages) {
        const artifacts = artifactsByMessage.get(msg.id);
        if (artifacts?.length) {
          msg.metadata = { ...msg.metadata, artifacts };
        }
      }
      // Attach orphans to the last assistant message (fallback recovery).
      const orphans = orphansByConvo.get(convoId);
      if (orphans?.length) {
        const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
        const target = lastAssistant ?? messages[messages.length - 1];
        if (target) {
          const existing = (target.metadata?.artifacts as Artifact[]) ?? [];
          target.metadata = { ...target.metadata, artifacts: [...existing, ...orphans] };
        }
      }
    }
  }

  return (convoRows as ConversationRow[]).map((row) =>
    rowToConversation(row, byConvo.get(row.id) ?? []),
  );
}

/**
 * Upsert a conversation and reconcile its message set. We must NOT delete-all
 * then re-insert: `artifacts.message_id` references `messages(id)` with
 * `on delete set null`, so wiping messages on every debounced sync would orphan
 * every generated file (its message_id becomes NULL and the file no longer
 * shows up on reload). Message ids are stable, so instead we upsert the current
 * messages by id and delete only the ones that were actually removed.
 */
export async function saveConversation(convo: Conversation, userId: string): Promise<void> {
  const supabase = getSupabaseBrowser();
  if (!supabase) return;

  const { error: convoErr } = await supabase
    .from('conversations')
    .upsert(conversationToRow(convo, userId), { onConflict: 'id' });
  if (convoErr) throw new Error(convoErr.message);

  // Delete by explicit id list, derived from what actually exists remotely.
  //
  // This used to compute the complement — `.not('id', 'in', '(' + keepIds + ')')`
  // — which had two problems: postgrest-js appends that value verbatim, so an id
  // containing a comma or paren silently changed the delete set; and at ~37 bytes
  // per uuid a 220-message conversation exceeded the edge's request-line limit,
  // returning 414 so the conversation never synced again. Listing the ids to
  // remove is bounded, quoted by the client, and can only ever delete rows we
  // just observed.
  const keep = new Set(convo.messages.map((m) => m.id));
  const existing = await selectAllPages<{ id: string }>((from, to) =>
    supabase.from('messages').select('id').eq('conversation_id', convo.id).range(from, to),
  );
  const toDelete = existing.map((r) => r.id).filter((id) => !keep.has(id));
  for (let i = 0; i < toDelete.length; i += 100) {
    const { error: delErr } = await supabase
      .from('messages')
      .delete()
      .in('id', toDelete.slice(i, i + 100));
    if (delErr) throw new Error(delErr.message);
  }

  if (convo.messages.length) {
    const rows = convo.messages.map((m, i) => messageToRow(m, convo.id, userId, i));
    const { error: upsertErr } = await supabase
      .from('messages')
      .upsert(rows, { onConflict: 'id' });
    if (upsertErr) throw new Error(upsertErr.message);
  }
}

/** Persist only the conversation row (title, model, pin, params) — no messages. */
export async function saveConversationMeta(convo: Conversation, userId: string): Promise<void> {
  const supabase = getSupabaseBrowser();
  if (!supabase) return;
  const { error } = await supabase
    .from('conversations')
    .upsert(conversationToRow(convo, userId), { onConflict: 'id' });
  if (error) throw new Error(error.message);
}

export async function deleteConversation(id: string): Promise<void> {
  const supabase = getSupabaseBrowser();
  if (!supabase) return;
  const { error } = await supabase.from('conversations').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
