import type { ConversationSummary, GenerationParams, Message } from '@/types';
import { TOOL_INSTRUCTIONS } from '@/lib/tools/prompt';
import { PATCH_INSTRUCTIONS } from '@/lib/tools/patch-prompt';

/** Wire types matching an Ollama-compatible proxy. */

export interface ApiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** base64-encoded images (no data-url prefix) for vision models. */
  images?: string[];
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
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    repeat_penalty?: number;
    num_ctx?: number;
    num_predict?: number;
  };
}

/** One NDJSON/SSE chunk from a streaming chat response (Ollama shape). */
export interface ChatStreamChunk {
  model?: string;
  /** `thinking` carries the model's reasoning stream, separate from content. */
  message?: { role?: string; content?: string; thinking?: string; images?: string[] };
  /** Some proxies use `response` (generate endpoint) instead of message.content. */
  response?: string;
  done?: boolean;
  // Timing/token stats present on the final chunk.
  total_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  prompt_eval_count?: number;
  error?: string;
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
export function toApiMessages(
  messages: Message[],
  systemPrompt: string,
  searchContext?: string,
  summary?: ConversationSummary,
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
        content += `\n\n[Attached file: ${att.name}]\n\`\`\`\n${att.text}\n\`\`\``;
      }
    }

    if (searchContext && i === lastUserIdx) {
      content += `\n\n---\n${searchContext}`;
    }

    out.push({
      role: m.role,
      content,
      ...(images.length ? { images } : {}),
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
