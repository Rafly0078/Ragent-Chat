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
import { loadSupabaseBrowser } from '@/lib/supabase/client';
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
  build: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
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
  const supabase = await loadSupabaseBrowser();
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
 * `updated_at` for a conversation row that exists only so its messages have
 * something to point at. See `saveConversation`: the real timestamp is written
 * last, so a row still holding this one is a save that did not finish, and the
 * merge on the next load treats the local copy as the newer one — it wins, and the
 * write is retried — instead of letting a half-written remote copy replace it.
 */
const UNWRITTEN_AT = new Date(0).toISOString();

/**
 * Upsert a conversation and reconcile its message set. We must NOT delete-all
 * then re-insert: `artifacts.message_id` references `messages(id)` with
 * `on delete set null`, so wiping messages on every debounced sync would orphan
 * every generated file (its message_id becomes NULL and the file no longer
 * shows up on reload). Message ids are stable, so instead we upsert the current
 * messages by id and delete only the ones that were actually removed.
 *
 * Order matters as much as content — the conversation row is written last. See the
 * final upsert.
 */
export async function saveConversation(convo: Conversation, userId: string): Promise<void> {
  const supabase = await loadSupabaseBrowser();
  if (!supabase) return;

  const row = conversationToRow(convo, userId);

  // All this does is make sure the row EXISTS, because `messages.conversation_id`
  // references it. `ignoreDuplicates` is ON CONFLICT DO NOTHING: it never updates a
  // row that is already there, so it cannot fire the `updated_at` trigger.
  if (convo.messages.length > 0) {
    const { error: seedErr } = await supabase
      .from('conversations')
      .upsert({ ...row, updated_at: UNWRITTEN_AT }, { onConflict: 'id', ignoreDuplicates: true });
    if (seedErr) throw new Error(seedErr.message);
  }

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
    const { error: upsertErr } = await supabase.from('messages').upsert(rows, { onConflict: 'id' });
    if (upsertErr) {
      // Migration 0006 adds `messages.thinking_blocks`. If the app ships before
      // that migration is applied, PostgREST rejects the whole upsert with
      // "column messages.thinking_blocks does not exist" — and since the sync
      // layer swallows errors, cloud sync would simply stop for every signed-in
      // user until somebody noticed. Retry once without the column, so a deploy
      // in the wrong order costs the ordered thinking blocks (which fall back to
      // the flattened content/reasoning mirrors) rather than the whole chat.
      if (/thinking_blocks/i.test(upsertErr.message)) {
        if (!warnedMissingThinkingBlocks) {
          warnedMissingThinkingBlocks = true;
          console.warn(
            '[conversations] messages.thinking_blocks is missing — apply ' +
              'supabase/migrations/0006_thinking_blocks.sql. Syncing without ordered ' +
              'thinking blocks; message text is unaffected.',
          );
        }
        const legacy = rows.map(({ thinking_blocks: _drop, ...rest }) => rest);
        const { error: retryErr } = await supabase
          .from('messages')
          .upsert(legacy, { onConflict: 'id' });
        if (retryErr) throw new Error(retryErr.message);
      } else {
        throw new Error(upsertErr.message);
      }
    }
  }

  // The conversation row goes last, now that its messages are actually there.
  //
  // It used to go first, and the `conversations_updated_at` trigger rewrites
  // `updated_at` to now() on every update — so a messages write that then failed (a
  // flaky connection, an RLS rejection, a body too large for a big paste, the tab
  // closing after the first request landed) left a remote copy NEWER than local but
  // missing the turn. The next load's merge handed that copy the win and the turn was
  // destroyed locally too, moments after a toast promised it was "still saved on this
  // device". Written here, `updated_at` moving means the whole conversation landed.
  const { error: convoErr } = await supabase
    .from('conversations')
    .upsert(row, { onConflict: 'id' });
  if (convoErr) throw new Error(convoErr.message);
}

/** Logged once per session, not once per debounced flush. */
let warnedMissingThinkingBlocks = false;

/** Persist only the conversation row (title, model, pin, params) — no messages. */
export async function saveConversationMeta(convo: Conversation, userId: string): Promise<void> {
  const supabase = await loadSupabaseBrowser();
  if (!supabase) return;
  const { error } = await supabase
    .from('conversations')
    .upsert(conversationToRow(convo, userId), { onConflict: 'id' });
  if (error) throw new Error(error.message);
}

export async function deleteConversation(id: string): Promise<void> {
  const supabase = await loadSupabaseBrowser();
  if (!supabase) return;

  // The FK cascade does not reach Storage. Deleting the conversation row deletes its
  // `artifacts` rows with it (`on delete cascade`), and those rows hold the only
  // record of where the files live — so without this the bytes stay in the bucket
  // forever, unreferenced and uncountable. Read the paths BEFORE the delete, and
  // remove the objects after: the row is the source of truth, so a tab that dies
  // in between leaves the leak we already had rather than a conversation whose
  // files have silently gone.
  const { data: files } = await supabase
    .from('artifacts')
    .select('bucket,storage_path')
    .eq('conversation_id', id);

  const { error } = await supabase.from('conversations').delete().eq('id', id);
  if (error) throw new Error(error.message);

  await removeStoredFiles(supabase, files ?? []);
}

/**
 * Best effort, one call per bucket. Never throws: the rows are already gone, so a
 * failure here is a leaked object, not a broken delete — and telling the user their
 * chat failed to delete when it did would be worse than the leak.
 */
async function removeStoredFiles(
  supabase: NonNullable<Awaited<ReturnType<typeof loadSupabaseBrowser>>>,
  files: Array<{ bucket: string | null; storage_path: string | null }>,
): Promise<void> {
  const byBucket = new Map<string, string[]>();
  for (const file of files) {
    if (!file.storage_path) continue;
    const bucket = file.bucket ?? 'artifacts';
    const paths = byBucket.get(bucket) ?? [];
    paths.push(file.storage_path);
    byBucket.set(bucket, paths);
  }
  for (const [bucket, paths] of byBucket) {
    const { error } = await supabase.storage.from(bucket).remove(paths);
    if (error) {
      console.warn(
        `[conversations] ${paths.length} file(s) left in ${bucket} — removal failed:`,
        error.message,
      );
    }
  }
}
