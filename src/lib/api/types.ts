import type { ConversationSummary, GenerationParams, Message, MessagePart } from '@/types';
import { TOOL_INSTRUCTIONS } from '@/lib/tools/prompt';
import { PATCH_INSTRUCTIONS } from '@/lib/tools/patch-prompt';

/** Wire types matching an Ollama-compatible proxy. */

export interface ApiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** base64-encoded images (no data-url prefix) for vision models. */
  images?: string[];
  /**
   * The assistant's own thinking blocks, replayed on a later turn.
   *
   * Anthropic requires this for interleaved thinking: a thinking block sent back
   * must carry its original `signature` verbatim, or the request is rejected.
   * Only `providerChat`'s anthropic branch consumes it; every other protocol
   * ignores it, which is why it's separate from `content` rather than inlined.
   */
  thinking?: { text: string; signature?: string; redacted?: boolean }[];
  /** Tool calls this assistant turn made. Replayed so the model sees its own request. */
  toolCalls?: WireToolCall[];
  /** On a `tool` message: which call this is the result of. */
  toolCallId?: string;
  /** On a `tool` message: whether the tool failed, so the model can repair. */
  toolError?: boolean;
}

export interface ChatRequest {
  model: string;
  messages: ApiChatMessage[];
  stream?: boolean;
  /**
   * Ollama `think` parameter — enables extended reasoning for capable models.
   * `true`/`false` toggle it; the string levels set the reasoning effort.
   */
  think?: boolean | 'low' | 'medium' | 'high' | 'max';
  /**
   * Tools offered to the model for NATIVE function calling.
   *
   * Every provider here supports this and none of it was ever sent: tools were
   * invoked by regex-scraping fenced directives out of the model's prose, which
   * meant no argument validation, no way to return a result, and no multi-step
   * loop. Present only when the active protocol supports it — the text-directive
   * path in `TOOL_INSTRUCTIONS` remains the fallback for everything else.
   */
  tools?: WireTool[];
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    repeat_penalty?: number;
    num_ctx?: number;
    num_predict?: number;
  };
}

/** A tool offered to the model, in a protocol-neutral shape. */
export interface WireTool {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

/**
 * A completed tool call requested by the model.
 *
 * Assembled server-side and emitted once, whole. Providers stream the arguments
 * JSON in fragments (`tool_calls[i].function.arguments` on OpenAI,
 * `input_json_delta` on Anthropic); accumulating there rather than here means the
 * client never has to parse partial JSON.
 */
export interface WireToolCall {
  id: string;
  name: string;
  /** Parsed arguments. `{}` when the model sent nothing parseable. */
  arguments: Record<string, unknown>;
}

/** One NDJSON/SSE chunk from a streaming chat response (Ollama shape). */
export interface ChatStreamChunk {
  model?: string;
  /** `thinking` carries the model's reasoning stream, separate from content. */
  message?: { role?: string; content?: string; thinking?: string; images?: string[] };
  /** Some proxies use `response` (generate endpoint) instead of message.content. */
  response?: string;
  done?: boolean;
  /**
   * Which ordered segment this chunk belongs to.
   *
   * Added for interleaved thinking. Without it a chunk could only say "here is
   * some thinking and/or some text", and the server was in fact packing both
   * into ONE chunk — which cannot express "thinking, then text", so the
   * ordering was destroyed before the client ever saw it. `index` is the
   * upstream content-block index (Anthropic) or a synthesized counter
   * (OpenAI-compatible, Ollama); `kind` says which stream the delta belongs to.
   *
   * Optional on purpose: `message.content` / `message.thinking` are still
   * populated exactly as before, so an older client, the raw-passthrough Ollama
   * bridge, and any third-party consumer of this endpoint keep working
   * unchanged. A client that understands `part` gets ordering; one that doesn't
   * degrades to the old flattened behaviour.
   */
  part?: {
    kind: 'text' | 'thinking';
    index: number;
    /** The upstream closed this block — nothing more will arrive for `index`. */
    done?: boolean;
    /** Anthropic thinking signature, delivered on the block's final event. */
    signature?: string;
    /** Anthropic returned the block encrypted; there is no readable text. */
    redacted?: boolean;
  };
  // Timing/token stats present on the final chunk.
  total_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  prompt_eval_count?: number;
  error?: string;
  /**
   * Complete tool calls the model requested, emitted once each. Present only on
   * the native function-calling path; the text-directive path leaves this absent.
   */
  tool_calls?: WireToolCall[];
}

export interface RawModelDetails {
  family?: string;
  families?: string[];
  parameter_size?: string;
  quantization_level?: string;
  format?: string;
}

export interface RawModel {
  name?: string;
  model?: string;
  size?: number;
  details?: RawModelDetails;
  // /api/show style fields sometimes merged in:
  context_length?: number;
  capabilities?: string[];
  /** Output ceiling when the endpoint reports one (see extractModelLimits). */
  max_output_tokens?: number;
}

export interface ModelsResponse {
  models?: RawModel[];
}

/**
 * Map app messages → wire messages, folding attachments into content/images.
 * When `searchContext` is provided, it's appended to the LAST user message as
 * grounding for a web-search-augmented turn — kept on the user turn (not a
 * separate system message) so it sits right next to the question it answers.
 */
/**
 * Above this many characters, an attachment's extracted text is NOT inlined in
 * full — the model gets a head plus the total size and reads the rest with
 * `read_attachment`.
 *
 * It used to be inlined whole, on every turn, forever. A 400k-character PDF (the
 * extractor's cap) therefore consumed most of the context window for the entire
 * rest of the conversation, was re-sent with every message, and the model had no
 * way to ask for a specific part of it. The head is kept because for most
 * attachments the opening is enough to know whether more is needed.
 */
export const ATTACHMENT_INLINE_LIMIT = 6_000;

function inlineAttachment(name: string, text: string, canPage: boolean): string {
  if (text.length <= ATTACHMENT_INLINE_LIMIT || !canPage) {
    return `\n\n[Attached file: ${name}]\n\`\`\`\n${text}\n\`\`\``;
  }
  const head = text.slice(0, ATTACHMENT_INLINE_LIMIT);
  return (
    `\n\n[Attached file: ${name} — ${text.length} characters, showing the first ` +
    `${ATTACHMENT_INLINE_LIMIT}. Call read_attachment with name "${name}" and an ` +
    `offset to read more.]\n\`\`\`\n${head}\n\`\`\``
  );
}

export function toApiMessages(
  messages: Message[],
  systemPrompt: string,
  searchContext?: string,
  summary?: ConversationSummary,
  /**
   * Whether `read_attachment` is actually callable this turn. Without native
   * function calling there is no way to page through anything, so truncating
   * would just lose the text — those providers keep getting it inlined whole.
   */
  toolsAvailable = false,
): ApiChatMessage[] {
  const out: ApiChatMessage[] = [];
  // TOOL_INSTRUCTIONS is always included — even conversations created before
  // this existed (whose stored systemPrompt predates it) still get a model
  // that knows the artifact directive format.
  const combinedSystem = [systemPrompt.trim(), TOOL_INSTRUCTIONS, PATCH_INSTRUCTIONS]
    .filter(Boolean)
    .join('\n\n');
  if (combinedSystem) out.push({ role: 'system', content: combinedSystem });

  // Compaction: when a running summary exists, prepend it as a system message
  // and drop every message up to and including the one it was summarized
  // through — the model keeps the memory at a fraction of the token cost. If
  // the marker message is no longer present (e.g. a mid-history edit), fall
  // back to sending everything so nothing is silently lost.
  let effective = messages;
  if (summary?.text) {
    out.push({
      role: 'system',
      content: `Summary of the earlier conversation (older messages have been condensed to save context; treat this as prior memory):\n\n${summary.text}`,
    });
    const cutoff = messages.findIndex((m) => m.id === summary.upToMessageId);
    if (cutoff !== -1) effective = messages.slice(cutoff + 1);
  }

  const lastUserIdx = effective.map((m) => m.role).lastIndexOf('user');

  for (let i = 0; i < effective.length; i++) {
    const m = effective[i]!;
    if (m.role === 'system') continue;
    if (m.error) continue;
    const images: string[] = [];
    let content = m.content;

    for (const att of m.attachments ?? []) {
      if (att.base64) images.push(att.base64);
      else if (att.text) {
        content += inlineAttachment(att.name, att.text, toolsAvailable);
      }
    }

    if (searchContext && i === lastUserIdx) {
      content += `\n\n---\n${searchContext}`;
    }

    // Replay the assistant's signed thinking blocks. Anthropic rejects a turn
    // that references earlier interleaved thinking without them, and until now
    // `reasoning` was simply dropped on every subsequent turn — which made
    // multi-turn interleaved thinking impossible rather than merely lossy.
    // Signature-less blocks are skipped: sending one is worse than sending none.
    const thinking = (m.parts ?? [])
      .filter((p): p is Extract<MessagePart, { kind: 'thinking' }> => p.kind === 'thinking')
      .filter((p) => p.signature !== undefined || p.redacted === true)
      .map((p) => ({
        text: p.text,
        ...(p.signature ? { signature: p.signature } : {}),
        ...(p.redacted ? { redacted: true } : {}),
      }));

    out.push({
      role: m.role,
      content,
      ...(images.length ? { images } : {}),
      ...(thinking.length ? { thinking } : {}),
    });
  }
  return out;
}

export function toApiOptions(p: GenerationParams): ChatRequest['options'] {
  return {
    temperature: p.temperature,
    top_p: p.topP,
    top_k: p.topK,
    repeat_penalty: p.repeatPenalty,
    num_ctx: p.contextLength,
    num_predict: p.maxTokens,
  };
}
