import type { ChatStreamChunk } from './types';

/**
 * Parse a streamed HTTP body into chat chunks. Supports both:
 *  - NDJSON (Ollama native): one JSON object per line
 *  - SSE: lines prefixed with `data: `, terminated by `data: [DONE]`
 *
 * Yields decoded chunks incrementally. Robust to partial lines across reads.
 */
export async function* parseChatStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Split on newlines; keep the trailing partial line in the buffer.
      let nlIndex: number;
      while ((nlIndex = buffer.indexOf('\n')) >= 0) {
        const rawLine = buffer.slice(0, nlIndex).trim();
        buffer = buffer.slice(nlIndex + 1);
        const chunk = decodeLine(rawLine);
        if (chunk) yield chunk;
      }
    }
    // Flush any final buffered line.
    const tail = buffer.trim();
    if (tail) {
      const chunk = decodeLine(tail);
      if (chunk) yield chunk;
    }
  } finally {
    // Ensure the underlying connection is released even on early break.
    try {
      await reader.cancel();
    } catch {
      /* noop */
    }
    reader.releaseLock();
  }
}

function decodeLine(line: string): ChatStreamChunk | null {
  if (!line) return null;
  let payload = line;
  if (line.startsWith('data:')) {
    payload = line.slice(5).trim();
    if (payload === '[DONE]') return { done: true };
  }
  try {
    return JSON.parse(payload) as ChatStreamChunk;
  } catch {
    // Ignore non-JSON keepalive lines (`:` comments, blank SSE separators).
    return null;
  }
}

/** Extract the text delta from a chunk regardless of endpoint shape. */
export function chunkText(chunk: ChatStreamChunk): string {
  return chunk.message?.content ?? chunk.response ?? '';
}

/** One ordered segment of the response, as reconstructed from the wire. */
export interface StreamPart {
  kind: 'text' | 'thinking';
  index: number;
  text: string;
  /** The upstream closed this block. */
  done?: boolean;
  signature?: string;
  redacted?: boolean;
}

/** `<think>` / `<thinking>`, the inline convention used by Qwen, QwQ and R1. */
const THINK_OPEN = /<think(?:ing)?\s*>/i;
const THINK_CLOSE = /<\/think(?:ing)?\s*>/i;
/** `</thinking>` is the longest tag, so never hold back more than this. */
const MAX_TAG_LEN = 12;

/**
 * Split off a trailing fragment that might be the start of a tag.
 *
 * Without this, a `<think>` arriving as `<thi` + `nk>` across two chunks would
 * be rendered as literal text and the reasoning would leak into the answer.
 */
function holdPartialTag(buf: string): [safe: string, held: string] {
  const from = Math.max(0, buf.length - MAX_TAG_LEN);
  const lt = buf.lastIndexOf('<', buf.length - 1);
  if (lt < from) return [buf, ''];
  // A '<' this close to the end is only worth holding if what follows it is
  // still a viable prefix of one of the two tags.
  const tail = buf.slice(lt).toLowerCase();
  const viable = '</thinking>'.startsWith(tail) || '<thinking>'.startsWith(tail);
  return viable ? [buf.slice(0, lt), buf.slice(lt)] : [buf, ''];
}

/**
 * Reconstruct ordered parts from a chunk stream.
 *
 * Three cases, and all three have to work:
 *
 *  - The server sent `part` metadata (cloud providers through
 *    `/api/providers/chat`). For a thinking part that ordering is already
 *    authoritative — pass it through. Anthropic gives real block indices; the
 *    OpenAI-compatible branch synthesizes them from thinking↔text transitions.
 *  - No `part`, but `message.thinking` and `message.content` are separate
 *    fields (Ollama, direct or over the raw-passthrough bridge — neither goes
 *    near our server). Indices are synthesized here the same way, so a model
 *    that alternates still produces ordered blocks.
 *  - The reasoning is inline in `content` as `<think>…</think>` (Qwen/QwQ/R1
 *    through an endpoint that doesn't split it out), with or without `part`.
 *    Nothing used to handle this at all: the tags rendered as literal text, and
 *    because they are HTML-shaped the markdown renderer swallowed them, so the
 *    reasoning silently became part of the answer. Split here — which is why a
 *    text block's index is always this router's own, never the server's.
 *
 * Stateful — one router per stream. Call `flush()` at the end to release any
 * text held back as a possible partial tag.
 */
export function createPartRouter(): {
  route: (chunk: ChatStreamChunk) => StreamPart[];
  flush: () => StreamPart[];
} {
  let synthKind: 'text' | 'thinking' | null = null;
  let synthIndex = -1;
  let inThinkTag = false;
  let held = '';

  const nextIndex = (kind: 'text' | 'thinking') => {
    if (synthKind !== kind) {
      synthKind = kind;
      synthIndex += 1;
    }
    return synthIndex;
  };

  const push = (out: StreamPart[], kind: 'text' | 'thinking', text: string) => {
    if (!text) return;
    out.push({ kind, index: nextIndex(kind), text });
  };

  /** Walk `content`, toggling on `<think>`/`</think>`, emitting as we go. */
  const routeInline = (out: StreamPart[], incoming: string) => {
    let buf = held + incoming;
    held = '';
    for (;;) {
      const pattern = inThinkTag ? THINK_CLOSE : THINK_OPEN;
      const match = pattern.exec(buf);
      if (!match) break;
      push(out, inThinkTag ? 'thinking' : 'text', buf.slice(0, match.index));
      buf = buf.slice(match.index + match[0].length);
      inThinkTag = !inThinkTag;
    }
    const [safe, partial] = holdPartialTag(buf);
    held = partial;
    push(out, inThinkTag ? 'thinking' : 'text', safe);
  };

  return {
    route(chunk) {
      const out: StreamPart[] = [];
      const thinking = chunk.message?.thinking ?? '';
      const content = chunk.message?.content ?? chunk.response ?? '';

      if (chunk.part) {
        const { kind, index, done, signature, redacted } = chunk.part;
        // `part` says which of the two streams a delta belongs to. It does NOT
        // say the provider separated its reasoning from its answer — and this
        // branch used to return unconditionally, which made case 3 above dead
        // code for every cloud provider, because the server stamps `part` on
        // every text delta it forwards. A self-hosted OpenAI-compatible endpoint
        // (vLLM, llama.cpp, LM Studio) serving Qwen3 or R1 with no reasoning
        // parser configured — the default — streams `<think>…</think>` inside
        // `content`, so the whole chain of thought arrived as a text part. The
        // tags are HTML-shaped, so the markdown renderer dropped them silently
        // and the reasoning rendered as ordinary answer prose. Text therefore
        // goes through the splitter here too; it is a no-op when there are no
        // tags, beyond renumbering the block.
        if (kind === 'text') {
          // Metadata-only text events are dropped rather than forwarded. A text
          // block's `done` carries the UPSTREAM index while the routed text
          // carries a synthesized one, so passing it on would append a spurious
          // empty text part at an index nothing else uses — and `done` is only
          // ever read for thinking blocks, which still pass through untouched.
          if (content) routeInline(out, content);
          return out;
        }
        if (thinking || done || signature || redacted) {
          out.push({
            kind,
            index,
            text: thinking,
            ...(done ? { done } : {}),
            ...(signature ? { signature } : {}),
            ...(redacted ? { redacted } : {}),
          });
        }
        return out;
      }

      // A provider that reports thinking in its own field is not also going to
      // wrap it in tags, so the two paths never both run on the same delta.
      if (thinking) push(out, 'thinking', thinking);
      if (content) routeInline(out, content);
      return out;
    },
    flush() {
      const out: StreamPart[] = [];
      if (held) {
        // Stream ended mid-fragment: it was never a tag, so it's just text.
        push(out, inThinkTag ? 'thinking' : 'text', held);
        held = '';
      }
      return out;
    },
  };
}
