'use client';

/**
 * Read a slice of an attachment's extracted text on demand.
 *
 * The problem this solves is not extraction — `fileToAttachment` already pulls
 * text out of PDFs and Office files, up to 400k characters. It is that
 * `toApiMessages` inlined ALL of it into the prompt, on EVERY turn, forever: a
 * long PDF quietly consumed most of the context window for the rest of the
 * conversation, and there was no way for the model to ask for part of it.
 *
 * Large attachments are now inlined as a head plus a pointer to this tool (see
 * ATTACHMENT_INLINE_LIMIT in lib/api/types.ts), and the model pages through the
 * rest when it needs to.
 *
 * A client tool because that is where the text lives — in the chat store, never
 * uploaded. `/api/tools/execute` has no access to it.
 */

import { useChatStore } from '@/lib/store/chat-store';
import type { Attachment } from '@/types';
import type { GenerateRequest } from '../types';

/** Cap per call, so one read can't undo the point of not inlining. */
const MAX_READ = 20_000;
const DEFAULT_READ = 8_000;

/** Every attachment in the conversation that has extracted text, newest first. */
function textAttachments(conversationId: string): Attachment[] {
  const convo = useChatStore.getState().conversations.find((c) => c.id === conversationId);
  if (!convo) return [];
  const out: Attachment[] = [];
  for (let i = convo.messages.length - 1; i >= 0; i--) {
    for (const att of convo.messages[i]!.attachments ?? []) {
      if (att.text) out.push(att);
    }
  }
  return out;
}

export default async function readAttachment(req: GenerateRequest): Promise<{ text: string }> {
  const conversationId = req.conversationId;
  if (!conversationId) throw new Error('read_attachment needs a conversation.');

  const available = textAttachments(conversationId);
  if (available.length === 0) {
    throw new Error('This conversation has no attachments with readable text.');
  }

  const wanted = (req.name ?? '').trim().toLowerCase();
  // Exact match first, then a substring — a model that shortens "Q3 Report
  // (final).pdf" to "Q3 Report" should still land on it rather than get an error.
  const att =
    (wanted && available.find((a) => a.name.toLowerCase() === wanted)) ||
    (wanted && available.find((a) => a.name.toLowerCase().includes(wanted))) ||
    (available.length === 1 ? available[0] : undefined);

  if (!att) {
    const names = available.map((a) => `"${a.name}"`).join(', ');
    throw new Error(
      wanted
        ? `No attachment matching "${req.name}". Available: ${names}.`
        : `Name the attachment to read. Available: ${names}.`,
    );
  }

  const full = att.text ?? '';
  const total = full.length;
  const offset = Math.max(0, Math.min(Math.floor(req.offset ?? 0), total));
  const length = Math.max(1, Math.min(Math.floor(req.length ?? DEFAULT_READ), MAX_READ));
  const slice = full.slice(offset, offset + length);
  const end = offset + slice.length;

  if (!slice) {
    return {
      text: `"${att.name}" is ${total} characters; offset ${offset} is past the end.`,
    };
  }

  const more =
    end < total
      ? `\n\n[${total - end} characters remain. Call read_attachment again with offset ${end}.]`
      : '\n\n[End of file.]';

  return {
    text: `"${att.name}" characters ${offset}-${end} of ${total}:\n\n${slice}${more}`,
  };
}
