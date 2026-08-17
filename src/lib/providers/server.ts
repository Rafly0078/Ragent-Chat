import 'server-only';

import { assertPublicUrl, BlockedUrlError } from '@/lib/server/public-url';
import type { ChatRequest, ChatStreamChunk } from '@/lib/api/types';
import { estimateTokens } from '@/lib/utils/format';
import { resolveMaxOutputTokens } from './limits';
import { PROVIDER_PRESETS, type ProviderConnection, type ProviderProtocol } from './types';

/**
 * How long to wait for an upstream to answer with *headers*. Deliberately not a
 * whole-request deadline: a streamed generation runs for minutes and must not be
 * cut off, so the clock stops as soon as headers arrive (see `fetchUpstream`).
 *
 * A `/models` probe answers from a table, so the short budget fits it. A chat
 * completion is a different shape of request: plenty of OpenAI-compatible
 * gateways buffer the entire upstream reply before emitting a single header, and
 * with reasoning at high effort that first header can be minutes out. Holding a
 * completion to the probe's budget is what turned a slow-but-healthy generation
 * into `The provider did not respond in time.` on every send. The Ollama path
 * never showed it because in direct mode the browser talks to the model itself,
 * with no proxy deadline in between.
 */
const CONNECT_TIMEOUT_MS = 20_000;
/**
 * Kept just under the client's `STREAM_IDLE_TIMEOUT_MS` (120s) so that when an
 * upstream really is dead, this side names the culprit ("the provider did not
 * respond in time") before the browser gives up with the vaguer "the connection
 * stalled". Equal values would race.
 */
const CHAT_CONNECT_TIMEOUT_MS = 110_000;
const MAX_ERROR_CHARS = 4_000;
const encoder = new TextEncoder();

export class ProviderError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}

export interface ProviderInput {
  provider?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
  protocol?: unknown;
}

function defaultProviderConfig(): {
  baseUrl: string;
  apiKey: string;
  protocol: ProviderProtocol;
} {
  return {
    baseUrl: (process.env.DEFAULT_AI_API_URL || process.env.NEXT_PUBLIC_DEFAULT_AI_API_URL || '')
      .trim()
      .replace(/\/+$/, ''),
    apiKey: (process.env.DEFAULT_AI_API_KEY || '').trim(),
    protocol:
      process.env.DEFAULT_AI_API_PROTOCOL === 'anthropic' ||
      process.env.NEXT_PUBLIC_DEFAULT_AI_PROTOCOL === 'anthropic'
        ? 'anthropic'
        : 'openai',
  };
}

/**
 * The built-in "Default" provider: a third-party OpenAI-compatible endpoint the
 * deployment owner pays for, so a brand-new visitor can chat without pasting any
 * credentials. Endpoint, key and model are server-only env vars — the browser
 * sends `provider: 'default'` and nothing else, and never sees any of them.
 */
export function builtInProviderConfig(): {
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol: ProviderProtocol;
  vision: boolean | undefined;
  contextLength: number | undefined;
  maxOutputTokens: number | undefined;
} {
  const vision = (process.env.DEFAULT_OPENAI_VISION || '').trim().toLowerCase();
  return {
    baseUrl: (process.env.DEFAULT_OPENAI_ENDPOINT || '').trim().replace(/\/+$/, ''),
    apiKey: (process.env.DEFAULT_OPENAI_API_KEY || '').trim(),
    model: (process.env.DEFAULT_OPENAI_MODEL || '').trim(),
    protocol: process.env.DEFAULT_OPENAI_PROTOCOL === 'anthropic' ? 'anthropic' : 'openai',
    // Tri-state on purpose. A cloud `/v1/models` response carries no capability
    // field, so the client falls back to matching the model name — which is
    // wrong for any multimodal model that doesn't advertise it there. Set this
    // to declare the answer instead of guessing; leave it unset to keep the
    // name heuristic.
    vision: vision === '' ? undefined : vision === 'true' || vision === '1',
    // The pinned model's real limits. This provider's model list is synthesised
    // from env rather than read from upstream, so without these the client had
    // nothing to size the context against and fell back to the slider's stored
    // number — a 1M-window model reading as 131072. Left unset, the server
    // probes the upstream `/models` entry instead (see providerModels).
    contextLength: envPositiveInt(process.env.DEFAULT_OPENAI_CONTEXT_LENGTH),
    maxOutputTokens: envPositiveInt(process.env.DEFAULT_OPENAI_MAX_OUTPUT_TOKENS),
  };
}

/** Parse a positive integer env var, treating unset/garbage as "not declared". */
function envPositiveInt(value: string | undefined): number | undefined {
  const n = Number((value || '').trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

const CLOUD_PROVIDERS = [
  'default',
  'openai',
  'anthropic',
  'openrouter',
  'groq',
  'deepseek',
  'custom',
] as const;

function isCloudProvider(value: unknown): value is (typeof CLOUD_PROVIDERS)[number] {
  return CLOUD_PROVIDERS.includes(value as (typeof CLOUD_PROVIDERS)[number]);
}

export function resolveProviderConnection(raw: ProviderInput): ProviderConnection {
  const provider = raw.provider;
  if (!isCloudProvider(provider)) {
    throw new ProviderError('Unknown cloud provider.', 400);
  }

  // Built-in provider: ignore every field the client sent. Taking `baseUrl` or
  // `apiKey` from the request here would turn this branch into an open proxy
  // that also leaks the server key's spending to an attacker-chosen host.
  if (provider === 'default') {
    const builtIn = builtInProviderConfig();
    // The model is as mandatory as the endpoint: this provider is pinned to one
    // model, so without an id there is nothing to pin it to and every request
    // would fall back to whatever the client asked for.
    if (!builtIn.baseUrl || !builtIn.model) {
      throw new ProviderError('The built-in provider is not configured on this server.', 503);
    }
    return {
      provider,
      baseUrl: builtIn.baseUrl,
      apiKey: builtIn.apiKey,
      protocol: builtIn.protocol,
    };
  }

  let apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
  if (provider !== 'custom') {
    if (!apiKey) throw new ProviderError('API key is required for this provider.', 400);
    const preset = PROVIDER_PRESETS[provider];
    return {
      provider,
      baseUrl: preset.baseUrl,
      protocol: preset.protocol,
      apiKey,
    };
  }

  const defaults = defaultProviderConfig();
  const rawBaseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : '';
  const baseUrl = (rawBaseUrl || defaults.baseUrl).replace(/\/+$/, '');
  const usesDefaultEndpoint = Boolean(defaults.baseUrl) && baseUrl === defaults.baseUrl;
  if (!apiKey && usesDefaultEndpoint) apiKey = defaults.apiKey;

  const protocol = raw.protocol || (usesDefaultEndpoint ? defaults.protocol : undefined);
  if (protocol !== 'openai' && protocol !== 'anthropic') {
    throw new ProviderError('Custom endpoint protocol must be OpenAI or Anthropic.', 400);
  }
  return { provider, baseUrl, apiKey, protocol: protocol as ProviderProtocol };
}

async function validateCustomBaseUrl(value: string): Promise<string> {
  // The SSRF rules live in lib/server/public-url.ts — `fetch_url` needs exactly
  // the same ones, and a second copy would have been the weaker copy. The extra
  // strictness here (no query, no fragment) is expressed through the options.
  try {
    const url = await assertPublicUrl(value, { allowQuery: false });
    return url.toString().replace(/\/+$/, '');
  } catch (err) {
    if (err instanceof BlockedUrlError) {
      throw new ProviderError(`Custom endpoint rejected: ${err.message}`, 400);
    }
    throw err;
  }
}

async function checkedConnection(connection: ProviderConnection): Promise<ProviderConnection> {
  if (connection.provider !== 'custom') return connection;
  return { ...connection, baseUrl: await validateCustomBaseUrl(connection.baseUrl) };
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function authHeaders(connection: ProviderConnection): Record<string, string> {
  if (connection.protocol === 'anthropic') {
    return {
      ...(connection.apiKey ? { 'x-api-key': connection.apiKey } : {}),
      'anthropic-version': '2023-06-01',
    };
  }
  return connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {};
}

async function fetchUpstream(
  target: string,
  init: RequestInit,
  signal?: AbortSignal,
  timeoutMs: number = CONNECT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(
    () => controller.abort(new DOMException('Provider connect timeout', 'TimeoutError')),
    timeoutMs,
  );

  try {
    const response = await fetch(target, {
      ...init,
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => {});
      throw new ProviderError('Provider redirects are blocked.', 502);
    }
    return response;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new ProviderError('The provider did not respond in time.', 504);
    }
    throw new ProviderError(error instanceof Error ? error.message : 'Provider request failed.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function providerError(response: Response): Promise<ProviderError> {
  const text = (await response.text().catch(() => '')).slice(0, MAX_ERROR_CHARS);
  let message = text || response.statusText || 'Provider request failed.';
  try {
    const body = JSON.parse(text) as {
      error?: string | { message?: string };
      message?: string;
    };
    if (typeof body.error === 'string') message = body.error;
    else if (body.error?.message) message = body.error.message;
    else if (body.message) message = body.message;
  } catch {
    // Keep the capped plain-text response.
  }
  return new ProviderError(message, response.status);
}

/** All a caller learns when the BUILT-IN provider's upstream fails. */
const BUILT_IN_UNAVAILABLE = 'The built-in provider is unavailable right now.';

/**
 * Replace an upstream error with a generic line on its way OUT to the caller.
 *
 * The built-in provider's endpoint and key are the deployment owner's, not the
 * caller's — so the gateway's own wording is about the owner: which host it sits
 * behind, that *their* account is out of quota, the masked prefix of *their*
 * key. All of it used to reach the browser verbatim (up to 4 KB of it), because
 * the providers/chat route serializes `ProviderError.message` into its JSON body
 * and nothing in between touched it. Same policy the search route already
 * applies to Tavily: log the upstream's words, hand back a generic sentence.
 *
 * Every other provider is the *user's* own endpoint talking, and that text is the
 * entire diagnostic they get ("insufficient balance", "model not found") — so it
 * passes through untouched.
 *
 * Applied here rather than inside `providerError` on purpose: `providerChat`
 * feeds that message to `rejectsMaxTokens`/`suggestedMaxTokens`, so scrubbing it
 * any earlier would silently kill the max_tokens retry. The status is preserved
 * for the same reason — the client keys "this model can't do thinking" off a
 * 400, not off the text.
 */
function clientSafe(connection: ProviderConnection, error: ProviderError): ProviderError {
  if (connection.provider !== 'default') return error;
  console.error(
    '[providers] built-in upstream returned',
    error.status,
    error.message.slice(0, 500),
  );
  return new ProviderError(BUILT_IN_UNAVAILABLE, error.status);
}

function inferImageMediaType(base64: string): string {
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('iVBOR')) return 'image/png';
  if (base64.startsWith('R0lGOD')) return 'image/gif';
  if (base64.startsWith('UklGR')) return 'image/webp';
  return 'image/png';
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const item = part as { text?: unknown; content?: unknown };
      return typeof item.text === 'string'
        ? item.text
        : typeof item.content === 'string'
          ? item.content
          : '';
    })
    .join('');
}

/** Never ask for less than this, however little context headroom is left. */
const OUTPUT_FLOOR = 4_096;
/** Anthropic rejects a `max_tokens` above the model's own output ceiling. */
const ANTHROPIC_OUTPUT_CEILING = 32_000;
/**
 * Output ceiling for a provider that publishes none. Generous enough that no
 * real answer is cut short, small enough that no gateway treats the request as
 * a reservation it has to queue for.
 */
const DEFAULT_OUTPUT_CEILING = 32_768;
/** Used when the client sent no `num_ctx` to size the budget against. */
const ASSUMED_CONTEXT = 32_768;
/** `estimateTokens` is a chars/4 heuristic and undercounts code and CJK text. */
const PROMPT_SAFETY = 1.2;
/** Flat per-image allowance, matching estimateMessageTokens on the client. */
const IMAGE_TOKENS = 768;
/** Role/template tokens the chat format adds around each message. */
const MESSAGE_OVERHEAD = 4;

function estimatePromptTokens(request: ChatRequest): number {
  let total = 0;
  for (const message of request.messages) {
    total += estimateTokens(message.content) + MESSAGE_OVERHEAD;
    total += (message.images?.length ?? 0) * IMAGE_TOKENS;
  }
  return Math.ceil(total * PROMPT_SAFETY);
}

const MAX_TOKEN_FIELDS = ['max_tokens', 'max_completion_tokens'] as const;

/** Does this upstream error read as "your max_tokens is out of range"? */
function rejectsMaxTokens(error: ProviderError): boolean {
  if (error.status !== 400 && error.status !== 422) return false;
  return /max_(?:tokens|completion_tokens|output_tokens)/i.test(error.message);
}

/**
 * Providers that reject an oversized cap almost always name the real ceiling in
 * the message ("supports at most 16384 completion tokens", "must be less than or
 * equal to 8192", "100000 > 64000"). Pull the largest number below what we asked
 * for and reuse it, so the retry still gets a long answer instead of falling
 * back to the provider's much smaller default. Model ids carry digits too, but
 * those are either tiny (`gpt-4o`) or larger than the request (`20250929`), so
 * the window filters them out. Returns null when nothing usable is in there.
 */
function suggestedMaxTokens(message: string, requested: number): number | null {
  const candidates = (message.match(/\d{2,}/g) ?? [])
    .map(Number)
    .filter((value) => Number.isSafeInteger(value) && value >= 256 && value < requested);
  return candidates.length ? Math.max(...candidates) : null;
}

/**
 * Ollama spells "generate until the model decides to stop" as `num_predict: -1`,
 * and neither the OpenAI nor the Anthropic protocol has a field for that.
 * Omitting `max_tokens` is NOT the same thing — it hands the ceiling to the
 * upstream, whose default is usually far below what the model can actually
 * produce (the gateway this app talks to defaults to exactly 8192). So
 * "unlimited" is resolved into an explicit budget: whatever is left of the
 * context window once the prompt is paid for, capped at what the model can
 * actually emit.
 *
 * That cap is the whole point. Context headroom is not an output ceiling: a 1M
 * window model still only writes ~8k-32k tokens, and asking a gateway to
 * reserve ~1M output tokens makes it stall long past our connect timeout, which
 * surfaced as a 504 on every send.
 */
function resolveMaxTokens(request: ChatRequest, ceiling: number): number {
  const requested = request.options?.num_predict;
  const context = request.options?.num_ctx;
  const window = typeof context === 'number' && context > 0 ? context : ASSUMED_CONTEXT;
  const headroom = window - estimatePromptTokens(request);

  // A positive value used to be treated as the user's explicit choice and passed
  // through untouched. It usually isn't one: with `maxTokensAuto` on — the
  // default, and undefined counts as on — the client resolves the slider's -1
  // into the provider's published output ceiling (resolve-limits.ts) and sends
  // *that* as `num_predict`, so the number arriving here is one WE computed. The
  // wire has no field that tells the two apart.
  //
  // Skipping the headroom clamp for it meant a big paste on a 128k-window model
  // went out as ~95k prompt tokens plus a 32768 completion reservation, and the
  // upstream answered "maximum context length is 128000 tokens, however you
  // requested ..." — which names no max_tokens field, so `rejectsMaxTokens`
  // below doesn't match, there is no retry, and the turn simply dies. Asking for
  // the ~8k that actually fit would have answered it.
  //
  // So clamp against the headroom as well, but never *raise* the request: a
  // deliberate `num_predict: 1000` stays 1000. The floor only guards the case
  // where the headroom is tiny or negative (the prompt already overflows), where
  // it is the unlimited branch's behaviour that applies.
  if (typeof requested === 'number' && requested > 0) {
    return Math.min(requested, ceiling, Math.max(OUTPUT_FLOOR, headroom));
  }

  return Math.max(OUTPUT_FLOOR, Math.min(ceiling, headroom));
}

/**
 * The largest output this model plausibly supports, for use as the ceiling on
 * an "unlimited" request. Prefers what the deployment declared, then what the
 * provider publishes, then a flat figure — never the context window, which for
 * a 1M-window model is not an output ceiling at all.
 */
function outputCeiling(connection: ProviderConnection, request: ChatRequest): number {
  if (connection.provider === 'default') {
    const declared = builtInProviderConfig().maxOutputTokens;
    if (declared) return declared;
  }
  return resolveMaxOutputTokens(connection.provider, request.model) ?? DEFAULT_OUTPUT_CEILING;
}

function openAiBody(connection: ProviderConnection, request: ChatRequest): Record<string, unknown> {
  const messages = request.messages.map((message) => {
    // A tool result. `tool_call_id` is what ties it back to the request, and
    // OpenAI rejects the turn without it.
    if (message.role === 'tool') {
      return {
        role: 'tool' as const,
        tool_call_id: message.toolCallId ?? '',
        content: message.content,
      };
    }
    // An assistant turn that requested tools has to replay them, or the model
    // sees a result for a call it never made.
    if (message.toolCalls?.length) {
      return {
        role: 'assistant' as const,
        content: message.content || null,
        // A DeepSeek-style gateway rejects this turn outright without the reasoning
        // it produced alongside the call ("The `reasoning_content` in the thinking
        // mode must be passed back to the API"), which failed every thinking turn
        // that generated a file — after the file had been written. Only sent when
        // the provider actually gave us reasoning, so nothing new reaches an
        // endpoint that never streamed any.
        ...(message.reasoning ? { reasoning_content: message.reasoning } : {}),
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      };
    }
    if (message.reasoning && message.role === 'assistant') {
      return {
        role: 'assistant' as const,
        content: message.content,
        reasoning_content: message.reasoning,
      };
    }
    if (!message.images?.length) return { role: message.role, content: message.content };
    return {
      role: message.role,
      content: [
        { type: 'text', text: message.content },
        ...message.images.map((image) => ({
          type: 'image_url',
          image_url: { url: `data:${inferImageMediaType(image)};base64,${image}` },
        })),
      ],
    };
  });
  const maxTokens = resolveMaxTokens(request, outputCeiling(connection, request));
  const body: Record<string, unknown> = {
    model: request.model,
    messages,
    stream: request.stream === true,
    temperature: request.options?.temperature,
    top_p: request.options?.top_p,
  };
  body[connection.provider === 'openai' ? 'max_completion_tokens' : 'max_tokens'] = maxTokens;
  if (request.stream && connection.provider === 'openai') {
    body.stream_options = { include_usage: true };
  }
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));
  }
  if (request.think) {
    let effort = request.think === true ? 'medium' : request.think;
    // OpenAI's `reasoning_effort` only accepts low|medium|high. `max` is an app-
    // internal level that works for Anthropic (via token budget) but is invalid
    // for OpenAI, so clamp it down to prevent the upstream from dropping thinking.
    if (effort === 'max') effort = 'high';
    body.reasoning_effort = effort;
    delete body.temperature;
    delete body.top_p;
  }
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}

type AnthropicContent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

function anthropicBody(request: ChatRequest): Record<string, unknown> {
  const system = request.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .filter(Boolean)
    .join('\n\n');
  const messages: { role: 'user' | 'assistant'; content: AnthropicContent[] }[] = [];
  for (const message of request.messages) {
    if (message.role === 'system') continue;
    const content: AnthropicContent[] = [];

    // A tool result is a USER turn on this protocol, not its own role.
    if (message.role === 'tool') {
      content.push({
        type: 'tool_result',
        tool_use_id: message.toolCallId ?? '',
        content: message.content,
        ...(message.toolError ? { is_error: true } : {}),
      });
      const prev = messages.at(-1);
      if (prev?.role === 'user') prev.content.push(...content);
      else messages.push({ role: 'user', content });
      continue;
    }

    // Thinking blocks come FIRST in an assistant turn — Anthropic requires the
    // replayed reasoning to precede the text it produced, each with its original
    // signature. Without this, interleaved thinking only ever worked for a single
    // turn: the next request referenced blocks it hadn't sent, and was rejected.
    for (const block of message.thinking ?? []) {
      // A redacted block goes back only when its payload actually survived the
      // round trip. The encrypted blob used to be dropped the moment it arrived
      // (see `openBlock`), so every one of these was stored with empty text and
      // then replayed as `{ data: '' }` on every later turn of that conversation
      // — a block Anthropic documents as one that must be handed back
      // *unmodified*. Messages persisted before that was fixed still hold the
      // empty ones, so skipping them here is what keeps an old conversation
      // sendable instead of poisoning every new request with it.
      if (block.redacted) {
        if (block.text) content.push({ type: 'redacted_thinking', data: block.text });
      } else if (block.signature) {
        content.push({ type: 'thinking', thinking: block.text, signature: block.signature });
      }
    }
    // An empty text block is a 400. That is reachable on an image-only turn,
    // where `content` is '' by design, so the block is conditional rather than
    // unconditional as it used to be.
    if (message.content) content.push({ type: 'text', text: message.content });
    for (const image of message.images ?? []) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: inferImageMediaType(image), data: image },
      });
    }
    // Tool requests come last in the turn that made them.
    for (const call of message.toolCalls ?? []) {
      content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
    }
    if (content.length === 0) continue;
    const previous = messages.at(-1);
    if (previous?.role === message.role) previous.content.push(...content);
    else messages.push({ role: message.role, content });
  }

  // The first turn on this protocol MUST be `user` — Anthropic answers a 400
  // ("first message must use the \"user\" role") otherwise, and that 400 is
  // indistinguishable from an unsupported-parameter one on the client, which
  // reacts by permanently disabling the thinking toggle for the model.
  //
  // We can arrive here with an assistant turn first. Context compaction picks
  // the cut for its running summary by token budget, so the keep window can open
  // on the model's answer rather than the question that produced it; every
  // system message above (including the summary itself) has just been folded
  // into `system`, so nothing shields it. It does not heal on its own either —
  // the errored turn is skipped when the next request is built, so the same cut
  // is recomputed and the same 400 comes back for the rest of the conversation.
  //
  // Dropping the orphaned answer is the only repair that doesn't invent a user
  // message the user never wrote: the summary block already carries the context
  // that answer came out of. This is the same shape of normalization the loop
  // above already does for empty text blocks and same-role runs, and it also
  // covers a mid-history edit that leaves an assistant turn leading. The last
  // remaining turn is kept whatever its role, because an empty `messages` is
  // simply a different 400.
  while (messages.length > 1 && messages[0]?.role === 'assistant') messages.shift();

  let maxTokens = resolveMaxTokens(request, ANTHROPIC_OUTPUT_CEILING);
  const body: Record<string, unknown> = {
    model: request.model,
    messages,
    stream: request.stream === true,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
  };

  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }

  if (request.think) {
    const budgets = { low: 1_024, medium: 2_048, high: 4_096, max: 8_192 } as const;
    const effort = request.think === true ? 'medium' : request.think;
    const budget = budgets[effort];
    maxTokens = Math.max(maxTokens, budget + 1_024);
    body.max_tokens = maxTokens;
    body.thinking = { type: 'enabled', budget_tokens: budget };
  } else {
    body.temperature = request.options?.temperature;
    body.top_p = request.options?.top_p;
  }
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}

export async function providerModels(
  input: ProviderInput,
  signal?: AbortSignal,
): Promise<{
  models: {
    name: string;
    model: string;
    details: { family: string };
    capabilities?: string[];
    context_length?: number;
    max_output_tokens?: number;
  }[];
}> {
  const connection = await checkedConnection(resolveProviderConnection(input));
  // The built-in provider is pinned to exactly one model. The upstream endpoint
  // serves many, but the deployment only pays for this one, so the picker is
  // never shown the rest — and `providerChat` overrides the model anyway, so a
  // client that hardcodes another id gets nowhere.
  if (connection.provider === 'default') {
    const { model, vision, contextLength, maxOutputTokens } = builtInProviderConfig();
    // Declared limits win; anything the deployment didn't declare is probed
    // from the upstream `/models` entry for this one model. The probe is
    // best-effort — a gateway that doesn't publish limits, or is briefly down,
    // must not take the model picker down with it.
    const probed =
      contextLength != null && maxOutputTokens != null
        ? {}
        : await probeModelLimits(connection, model, signal);
    const context = contextLength ?? probed.context_length;
    const output = maxOutputTokens ?? probed.max_output_tokens;
    return {
      models: [
        {
          name: model,
          model,
          details: { family: connection.provider },
          // Only sent when the deployment declared an answer. Sending `[]`
          // unconditionally would read as "no vision" and override the client's
          // name-based fallback with a guess the server never made.
          ...(vision === undefined ? {} : { capabilities: vision ? ['vision'] : [] }),
          ...(context == null ? {} : { context_length: context }),
          ...(output == null ? {} : { max_output_tokens: output }),
        },
      ],
    };
  }

  const response = await fetchUpstream(
    endpoint(connection.baseUrl, 'models'),
    { method: 'GET', headers: { Accept: 'application/json', ...authHeaders(connection) } },
    signal,
  );
  if (!response.ok) throw await providerError(response);
  const body = (await response.json()) as { data?: unknown[]; models?: unknown[] } | unknown[];
  const data = Array.isArray(body)
    ? body
    : Array.isArray(body.data)
      ? body.data
      : (body.models ?? []);
  const seen = new Set<string>();
  const models = data.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as { id?: unknown; name?: unknown; model?: unknown };
    const name = [raw.id, raw.name, raw.model].find((value) => typeof value === 'string');
    if (typeof name !== 'string' || !name.trim() || seen.has(name)) return [];
    seen.add(name);
    // Most OpenAI-compatible /models responses say nothing about the window,
    // but some do (OpenRouter, vLLM, LM Studio, llama.cpp). Pass through what
    // is there so the client can size the context against the real limit
    // instead of a guess; absent fields are simply omitted.
    const limits = extractModelLimits(item as Record<string, unknown>);
    return [{ name, model: name, details: { family: connection.provider }, ...limits }];
  });
  return { models };
}

/**
 * Ask an upstream `/models` for one model's limits. Best-effort by design:
 * every failure path returns `{}` so the caller falls back to its own defaults
 * rather than surfacing an error. Used by the built-in provider, whose model
 * list is synthesised from env and so carries no limits of its own.
 */
async function probeModelLimits(
  connection: ProviderConnection,
  model: string,
  signal?: AbortSignal,
): Promise<{ context_length?: number; max_output_tokens?: number }> {
  try {
    const response = await fetchUpstream(
      endpoint(connection.baseUrl, 'models'),
      { method: 'GET', headers: { Accept: 'application/json', ...authHeaders(connection) } },
      signal,
    );
    if (!response.ok) return {};
    const body = (await response.json()) as { data?: unknown[]; models?: unknown[] } | unknown[];
    const data = Array.isArray(body)
      ? body
      : Array.isArray(body.data)
        ? body.data
        : (body.models ?? []);
    const entry = data.find((item) => {
      if (!item || typeof item !== 'object') return false;
      const raw = item as { id?: unknown; name?: unknown; model?: unknown };
      return [raw.id, raw.name, raw.model].some((value) => value === model);
    });
    return entry ? extractModelLimits(entry as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Pull a context window / output ceiling out of one `/models` entry.
 *
 * There is no standard for this, so we probe the field names actually seen in
 * the wild: OpenRouter (`context_length`, `top_provider.context_length`,
 * `top_provider.max_completion_tokens`), vLLM and llama.cpp
 * (`max_model_len` / `n_ctx`), LM Studio (`max_context_length`), and the
 * OpenAI-documented `context_window`. Anything non-numeric is ignored.
 */
function extractModelLimits(raw: Record<string, unknown>): {
  context_length?: number;
  max_output_tokens?: number;
} {
  const top =
    raw.top_provider && typeof raw.top_provider === 'object'
      ? (raw.top_provider as Record<string, unknown>)
      : {};

  const context = firstPositiveInt([
    raw.context_length,
    raw.context_window,
    raw.max_context_length,
    raw.max_model_len,
    raw.n_ctx,
    top.context_length,
  ]);
  const output = firstPositiveInt([
    raw.max_output_tokens,
    raw.max_completion_tokens,
    top.max_completion_tokens,
  ]);

  return {
    ...(context == null ? {} : { context_length: context }),
    ...(output == null ? {} : { max_output_tokens: output }),
  };
}

function firstPositiveInt(values: unknown[]): number | null {
  for (const value of values) {
    const n = typeof value === 'string' ? Number(value) : value;
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return null;
}

function normalizedNonStream(
  protocol: ProviderProtocol,
  body: unknown,
  fallbackModel: string,
): ChatStreamChunk {
  if (!body || typeof body !== 'object') throw new ProviderError('Provider returned invalid JSON.');
  if (protocol === 'anthropic') {
    const data = body as {
      model?: string;
      content?: { type?: string; text?: string; thinking?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const blocks = data.content ?? [];
    return {
      model: data.model ?? fallbackModel,
      message: {
        role: 'assistant',
        content: blocks
          .filter((x) => x.type === 'text')
          .map((x) => x.text ?? '')
          .join(''),
        thinking: blocks
          .filter((x) => x.type === 'thinking')
          .map((x) => x.thinking ?? '')
          .join(''),
      },
      done: true,
      prompt_eval_count: data.usage?.input_tokens,
      eval_count: data.usage?.output_tokens,
    };
  }

  const data = body as {
    model?: string;
    choices?: {
      message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown };
    }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const message = data.choices?.[0]?.message;
  return {
    model: data.model ?? fallbackModel,
    message: {
      role: 'assistant',
      content: textValue(message?.content),
      thinking: textValue(message?.reasoning_content ?? message?.reasoning),
    },
    done: true,
    prompt_eval_count: data.usage?.prompt_tokens,
    eval_count: data.usage?.completion_tokens,
  };
}

function ndjson(chunk: ChatStreamChunk): Uint8Array {
  return encoder.encode(`${JSON.stringify(chunk)}\n`);
}

function providerStream(
  response: Response,
  protocol: ProviderProtocol,
  fallbackModel: string,
  /**
   * Scrub the upstream's own error text before it reaches the caller. Set for the
   * built-in provider only — `clientSafe` does this for every error that arrives
   * *before* the stream opens, and an upstream that fails mid-generation leaks by
   * exactly the same route: the `error` event's message is forwarded verbatim in
   * an NDJSON chunk, and the client raises it as the turn's error text.
   */
  scrubErrors = false,
): ReadableStream<Uint8Array> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let model = fallbackModel;
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  let finished = false;
  /** Anthropic only: content-block index → what kind of block it is. */
  const blockKinds = new Map<number, 'text' | 'thinking' | 'tool_use'>();
  /**
   * Tool calls under construction, keyed by block/choice index.
   *
   * Both protocols stream the arguments JSON in fragments, so they are assembled
   * here and emitted once, whole — the client never has to parse partial JSON.
   */
  const pendingCalls = new Map<number, { id: string; name: string; args: string }>();
  /** Synthesized block state for protocols with no upstream index. */
  let synthKind: 'text' | 'thinking' | null = null;
  let synthCounter = -1;
  /**
   * One upstream `error` event's message, as the caller may see it. Whether it is
   * theirs to read is decided by `scrubErrors` above; a user-configured endpoint's
   * words are the only diagnostic they get, so those pass straight through.
   */
  const errorText = (message: string): string => {
    if (!scrubErrors) return message;
    console.error('[providers] built-in upstream stream error', message.slice(0, 500));
    return BUILT_IN_UNAVAILABLE;
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = '';
      const finish = () => {
        if (finished) return;
        finished = true;
        controller.enqueue(
          ndjson({
            model,
            message: { role: 'assistant', content: '' },
            done: true,
            prompt_eval_count: promptTokens,
            eval_count: completionTokens,
          }),
        );
      };
      /**
       * Emit one ordered segment.
       *
       * `message.content` / `message.thinking` are still populated exactly as
       * before so nothing downstream of this endpoint breaks; `part` is the new
       * ordering metadata. A signature-only event carries no text, and is still
       * emitted — that is how the signature reaches the client.
       */
      const emitPart = (
        index: number,
        kind: 'text' | 'thinking',
        text: string,
        extra?: { signature?: string; redacted?: boolean; done?: boolean },
      ) => {
        if (!text && !extra?.signature && !extra?.redacted && !extra?.done) return;
        controller.enqueue(
          ndjson({
            model,
            message: {
              role: 'assistant',
              content: kind === 'text' ? text : '',
              thinking: kind === 'thinking' ? text : '',
            },
            part: { kind, index, ...extra },
            done: false,
          }),
        );
      };

      /**
       * Anthropic `content_block_start` — remember the kind for this index.
       *
       * `data` is a `redacted_thinking` block's payload: reasoning the provider's
       * own classifier encrypted, opaque to us but not to the model. It used to
       * be read off the event type and then dropped right here, so the block
       * reached the client with empty text, the reasoning was lost for good (and
       * persisted that way, so no reload could recover it), and every later turn
       * replayed the block as `{ data: '' }` — see the replay guard in
       * `anthropicBody`. Carrying it through as the block's text is what closes
       * that round trip; there is no other field on the wire to put it in.
       */
      const openBlock = (index: number, kind: 'text' | 'thinking', redacted = false, data = '') => {
        blockKinds.set(index, kind);
        if (redacted) emitPart(index, 'thinking', data, { redacted: true });
      };

      /**
       * Assemble and emit one completed tool call. Arguments that don't parse are
       * sent as `{}` rather than dropped — the executor's validation then returns
       * a message the model can act on, which is strictly better than silence.
       */
      const flushCall = (index: number) => {
        const call = pendingCalls.get(index);
        if (!call) return;
        pendingCalls.delete(index);
        if (!call.name) return;
        let args: Record<string, unknown> = {};
        const raw = call.args.trim();
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              args = parsed as Record<string, unknown>;
            }
          } catch {
            /* leave {} — validation downstream explains what was wrong */
          }
        }
        controller.enqueue(
          ndjson({
            model,
            message: { role: 'assistant', content: '' },
            tool_calls: [{ id: call.id, name: call.name, arguments: args }],
            done: false,
          }),
        );
      };

      const flushAllCalls = () => {
        for (const index of [...pendingCalls.keys()]) flushCall(index);
      };

      /**
       * Tell the client a call has started, once per call.
       *
       * `flushCall` above is the only other place a tool call reaches the client, and
       * it cannot fire until the arguments are complete — which, for a document tool,
       * is after the whole file has been dictated. This is the same event minus the
       * arguments, sent the moment the name is known, so the UI can say a file is
       * being written while it is being written.
       */
      const announced = new Set<number>();
      const announceCall = (index: number, name: string) => {
        if (!name || announced.has(index)) return;
        announced.add(index);
        controller.enqueue(ndjson({ model, tool_call_start: { name }, done: false }));
      };

      /** Anthropic `content_block_stop` — tell the client the block is final. */
      const closeBlock = (index: number) => {
        const kind = blockKinds.get(index);
        if (!kind) return;
        blockKinds.delete(index);
        if (kind === 'tool_use') {
          flushCall(index);
          return;
        }
        emitPart(index, kind, '', { done: true });
      };

      /**
       * Block index for protocols that don't provide one (OpenAI-compatible,
       * and Ollama through the `<think>` splitter). Bumps only when the kind
       * changes, so a run of consecutive text deltas stays one part and a flip
       * to thinking opens the next.
       */
      const synthIndex = (kind: 'text' | 'thinking') => {
        if (synthKind !== kind) {
          synthKind = kind;
          synthCounter += 1;
        }
        return synthCounter;
      };

      const handle = (dataText: string) => {
        if (!dataText || dataText === '[DONE]') {
          if (dataText === '[DONE]') finish();
          return;
        }
        let event: unknown;
        try {
          event = JSON.parse(dataText);
        } catch {
          return;
        }
        if (!event || typeof event !== 'object') return;

        if (protocol === 'anthropic') {
          const data = event as {
            type?: string;
            index?: number;
            content_block?: {
              type?: string;
              thinking?: string;
              text?: string;
              data?: string;
              id?: string;
              name?: string;
            };
            message?: { model?: string; usage?: { input_tokens?: number } };
            delta?: {
              type?: string;
              text?: string;
              thinking?: string;
              signature?: string;
              partial_json?: string;
              stop_reason?: string;
            };
            usage?: { output_tokens?: number };
            error?: { message?: string };
          };
          if (data.type === 'error') {
            controller.enqueue(
              ndjson({
                error: errorText(data.error?.message ?? 'Anthropic stream error.'),
                done: true,
              }),
            );
            finished = true;
            return;
          }
          if (data.message?.model) model = data.message.model;
          if (data.message?.usage?.input_tokens !== undefined) {
            promptTokens = data.message.usage.input_tokens;
          }
          if (data.usage?.output_tokens !== undefined) completionTokens = data.usage.output_tokens;

          // Anthropic is the ONE provider that tells us where blocks begin and
          // end, and those boundaries are precisely the interleaving signal.
          // They used to be dropped on the floor: only `content_block_delta` was
          // handled, `index` wasn't even declared on the delta type, and content
          // and thinking were packed into a single chunk — which cannot express
          // "thinking, then text". Tracking start/stop here is what lets the
          // client reconstruct think → answer → think in the right order.
          if (data.type === 'content_block_start') {
            const kind = data.content_block?.type;
            if (kind === 'thinking' || kind === 'redacted_thinking') {
              openBlock(
                data.index ?? 0,
                'thinking',
                kind === 'redacted_thinking',
                data.content_block?.data ?? '',
              );
            } else if (kind === 'text') {
              openBlock(data.index ?? 0, 'text');
            } else if (kind === 'tool_use') {
              const idx = data.index ?? 0;
              blockKinds.set(idx, 'tool_use');
              pendingCalls.set(idx, {
                id: data.content_block?.id ?? `call_${idx}`,
                name: data.content_block?.name ?? '',
                args: '',
              });
              // Anthropic names the tool in the block header, so the client hears
              // about it before a single argument byte has arrived.
              announceCall(idx, data.content_block?.name ?? '');
            }
            return;
          }
          if (data.type === 'content_block_delta') {
            const idx = data.index ?? 0;
            if (data.delta?.type === 'text_delta') {
              emitPart(idx, 'text', data.delta.text ?? '');
            } else if (data.delta?.type === 'thinking_delta') {
              emitPart(idx, 'thinking', data.delta.thinking ?? '');
            } else if (data.delta?.type === 'signature_delta') {
              // Carries no text. The signature must survive to the client and
              // back upstream on the next turn, or Anthropic rejects a request
              // that replays this thinking block.
              emitPart(idx, 'thinking', '', { signature: data.delta.signature });
            } else if (data.delta?.type === 'input_json_delta') {
              const call = pendingCalls.get(idx);
              if (call) call.args += data.delta.partial_json ?? '';
            }
            return;
          }
          if (data.type === 'content_block_stop') {
            closeBlock(data.index ?? 0);
            return;
          }
          if (data.type === 'message_stop') {
            flushAllCalls();
            finish();
          }
          return;
        }

        const data = event as {
          model?: string;
          choices?: {
            delta?: {
              content?: unknown;
              reasoning_content?: unknown;
              reasoning?: unknown;
              tool_calls?: {
                index?: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }[];
            };
            finish_reason?: unknown;
          }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
          error?: { message?: string };
        };
        if (data.error?.message) {
          controller.enqueue(ndjson({ error: errorText(data.error.message), done: true }));
          finished = true;
          return;
        }
        if (data.model) model = data.model;
        if (data.usage) {
          promptTokens = data.usage.prompt_tokens;
          completionTokens = data.usage.completion_tokens;
        }
        const choice = data.choices?.[0];
        const content = textValue(choice?.delta?.content);
        const thinking = textValue(choice?.delta?.reasoning_content ?? choice?.delta?.reasoning);
        // No upstream block index exists on this protocol, so boundaries are
        // synthesized from the thinking↔text transition (see `synthIndex`).
        // Emitted as two separate chunks rather than one merged chunk, in the
        // order the fields appear, so a provider that flips mid-response still
        // produces ordered parts.
        if (thinking) emitPart(synthIndex('thinking'), 'thinking', thinking);
        if (content) emitPart(synthIndex('text'), 'text', content);

        // Tool calls arrive as fragments spread across many deltas: the first
        // carries `id` and `function.name`, the rest append to
        // `function.arguments`. Accumulate by index.
        for (const part of choice?.delta?.tool_calls ?? []) {
          const idx = part.index ?? 0;
          const existing = pendingCalls.get(idx);
          if (existing) {
            if (part.id) existing.id = part.id;
            if (part.function?.name) existing.name = part.function.name;
            existing.args += part.function?.arguments ?? '';
          } else {
            pendingCalls.set(idx, {
              id: part.id ?? `call_${idx}`,
              name: part.function?.name ?? '',
              args: part.function?.arguments ?? '',
            });
          }
          announceCall(idx, pendingCalls.get(idx)?.name ?? '');
        }
        // `finish_reason` was destructured and then never used, which is why
        // `tool_calls` was invisible even when the upstream announced it.
        if (choice?.finish_reason === 'tool_calls' || choice?.finish_reason === 'stop') {
          flushAllCalls();
        }
      };

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          if (buffer.includes('data:')) {
            const events = buffer.split(/\r?\n\r?\n/);
            buffer = events.pop() ?? '';
            for (const block of events) {
              const data = block
                .split(/\r?\n/)
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).trimStart())
                .join('\n');
              handle(data);
            }
          } else {
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? '';
            for (const line of lines) handle(line.trim());
          }
        }
        const tail = `${buffer}${decoder.decode()}`.trim();
        if (tail) {
          if (tail.includes('data:')) {
            const data = tail
              .split(/\r?\n/)
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trimStart())
              .join('\n');
            handle(data);
          } else handle(tail);
        }
        // A provider that ends the stream without a terminal `finish_reason` or
        // `message_stop` would otherwise leave a fully-assembled call unsent.
        flushAllCalls();
        finish();
        controller.close();
      } catch (error) {
        if (!finished) {
          controller.enqueue(
            ndjson({
              error: error instanceof Error ? error.message : 'Provider stream failed.',
              done: true,
            }),
          );
        }
        controller.close();
      } finally {
        reader.releaseLock();
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

export async function providerChat(
  input: ProviderInput,
  request: ChatRequest,
  signal?: AbortSignal,
): Promise<Response> {
  const connection = await checkedConnection(resolveProviderConnection(input));
  if (!request || typeof request !== 'object' || !Array.isArray(request.messages)) {
    throw new ProviderError('Invalid chat request.', 400);
  }
  // The built-in provider is locked to one model. Overriding rather than
  // validating is deliberate: the client never has a say, so stale local state
  // or a hand-crafted request can't route the owner's key at a model they
  // aren't paying for.
  if (connection.provider === 'default') {
    request = { ...request, model: builtInProviderConfig().model };
  }
  if (!request.model) throw new ProviderError('Invalid chat request.', 400);
  const protocol = connection.protocol;
  const path = protocol === 'anthropic' ? 'messages' : 'chat/completions';
  const body = protocol === 'anthropic' ? anthropicBody(request) : openAiBody(connection, request);
  const post = (payload: Record<string, unknown>) =>
    fetchUpstream(
      endpoint(connection.baseUrl, path),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: request.stream ? 'text/event-stream' : 'application/json',
          ...authHeaders(connection),
        },
        body: JSON.stringify(payload),
      },
      signal,
      CHAT_CONNECT_TIMEOUT_MS,
    );

  let response = await post(body);
  if (!response.ok) {
    const error = await providerError(response);
    // Our ceiling is a per-provider figure, which is still above what some
    // individual models will emit in one reply — those providers reject the
    // request outright instead of clamping. Retry at the ceiling they named, or
    // uncapped if they named none: a shorter answer beats a failed turn.
    // `rejectsMaxTokens` and `suggestedMaxTokens` read the upstream's raw words,
    // which is why `clientSafe` is applied on the way out and not before.
    if (!rejectsMaxTokens(error)) throw clientSafe(connection, error);
    const field = MAX_TOKEN_FIELDS.find((name) => typeof body[name] === 'number');
    const requested = field ? (body[field] as number) : 0;
    const suggested = field ? suggestedMaxTokens(error.message, requested) : null;
    const relaxed = { ...body };
    if (suggested !== null && field) relaxed[field] = suggested;
    else for (const name of MAX_TOKEN_FIELDS) delete relaxed[name];
    response = await post(relaxed);
    if (!response.ok) throw clientSafe(connection, await providerError(response));
  }

  if (request.stream) {
    if (!response.body) throw new ProviderError('Provider returned no stream body.');
    return new Response(
      providerStream(response, protocol, request.model, connection.provider === 'default'),
      {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Cache-Control': 'no-store, no-transform',
          Connection: 'keep-alive',
        },
      },
    );
  }

  const normalized = normalizedNonStream(protocol, await response.json(), request.model);
  return Response.json(normalized, { headers: { 'Cache-Control': 'no-store' } });
}
