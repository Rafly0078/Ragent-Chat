/**
 * Pure folding of streamed segments into a message's ordered parts.
 *
 * Split out of `chat-store` deliberately: this is the logic that makes
 * interleaved thinking correct, it has no store or React dependency, and keeping
 * it here means it can be exercised on its own rather than only through a live
 * stream.
 */

import type { Message, MessagePart } from '@/types';
import { flattenParts } from '@/types';

/**
 * One streamed segment delta.
 *
 * Deliberately looser than `MessagePart`: the stream only knows the kind, the
 * block index and the text — timing, signatures and closure are decided here.
 */
export interface PartDelta {
  kind: MessagePart['kind'];
  index: number;
  text: string;
  /** The upstream closed this block. */
  done?: boolean;
  signature?: string;
  redacted?: boolean;
}

/** A thinking part stops accepting deltas once it has ended. */
function isClosed(p: MessagePart): boolean {
  return p.kind === 'thinking' && p.endedAt !== undefined;
}

/**
 * Fold a frame's worth of stream deltas into a message's ordered parts.
 *
 * A delta extends the LAST part when its `(kind, index)` matches, and otherwise
 * opens a new one — which is what makes think → answer → think land as three
 * parts instead of collapsing into two buffers. Matching only against the last
 * part, rather than searching by index, is deliberate: a provider that reuses an
 * index after a gap (or a `<think>` splitter that restarts its counter) should
 * still produce a new visible block rather than reopening a closed one.
 *
 * `content`/`reasoning` are re-derived here so the flattened mirrors that the
 * rest of the app depends on can never drift from the ordered truth.
 *
 * `now` is injectable so the result is deterministic under test.
 */
export function withParts(m: Message, incoming: PartDelta[], now = Date.now()): Message {
  const parts: MessagePart[] = m.parts ? [...m.parts] : seedParts(m);

  for (const d of incoming) {
    const last = parts[parts.length - 1];
    const extend =
      last !== undefined && last.kind === d.kind && last.index === d.index && !isClosed(last);

    if (extend && last) {
      parts[parts.length - 1] =
        last.kind === 'thinking'
          ? {
              ...last,
              text: last.text + d.text,
              ...(d.signature ? { signature: d.signature } : {}),
              ...(d.redacted ? { redacted: true } : {}),
              ...(d.done ? { endedAt: now } : {}),
            }
          : { ...last, text: last.text + d.text };
      continue;
    }

    if (d.kind === 'thinking') {
      parts.push({
        kind: 'thinking',
        index: d.index,
        text: d.text,
        startedAt: now,
        ...(d.signature ? { signature: d.signature } : {}),
        ...(d.redacted ? { redacted: true } : {}),
        ...(d.done ? { endedAt: now } : {}),
      });
    } else {
      parts.push({ kind: 'text', index: d.index, text: d.text });
    }
  }

  return { ...m, parts, ...flattenParts(parts) };
}

/**
 * Adapt a message that predates ordered parts, so a `continue`/`regenerate` on
 * it appends rather than silently discarding what is already there. Reproduces
 * the only ordering the old flat model could express: all thinking, then all
 * text.
 */
export function seedParts(m: Message): MessagePart[] {
  const parts: MessagePart[] = [];
  if (m.reasoning) {
    const started = m.createdAt;
    parts.push({
      kind: 'thinking',
      index: -1,
      text: m.reasoning,
      startedAt: started,
      endedAt: started + (m.reasoningTimeMs ?? 0),
    });
  }
  if (m.content) parts.push({ kind: 'text', index: -1, text: m.content });
  return parts;
}

/**
 * Close the trailing thinking part. Called when the stream ends for any reason,
 * so a panel never sits on "Thinking…" forever — and, on abort or error, so the
 * UI can say the block was cut off rather than completed.
 */
export function sealed(m: Message, interrupted?: boolean, now = Date.now()): Message {
  if (!m.parts?.length) return m;
  const last = m.parts[m.parts.length - 1]!;
  if (last.kind !== 'thinking' || last.endedAt !== undefined) return m;
  const parts: MessagePart[] = [
    ...m.parts.slice(0, -1),
    { ...last, endedAt: now, ...(interrupted ? { interrupted: true } : {}) },
  ];
  return { ...m, parts, ...flattenParts(parts) };
}
