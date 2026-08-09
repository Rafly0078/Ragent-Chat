import 'server-only';

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { ChatRequest, ChatStreamChunk } from '@/lib/api/types';
import { estimateTokens } from '@/lib/utils/format';
import { PROVIDER_PRESETS, type ProviderConnection, type ProviderProtocol } from './types';

const CONNECT_TIMEOUT_MS = 20_000;
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

function blockedIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    return true;
  const [a, b, c] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function blockedIpv6(address: string): boolean {
  const value = address.toLowerCase().split('%')[0]!;
  if (value === '::' || value === '::1') return true;
  const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return blockedIpv4(mapped);
  const first = Number.parseInt(value.split(':')[0] || '0', 16);
  return (
    (first >= 0xfc00 && first <= 0xfdff) ||
    (first >= 0xfe80 && first <= 0xfebf) ||
    first >= 0xff00 ||
    value.startsWith('2001:db8:') ||
    value === '2001:db8::' ||
    value.startsWith('2001:0:') ||
    value.startsWith('2002:') ||
    value.startsWith('64:ff9b:')
  );
}

function blockedAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? blockedIpv4(address) : family === 6 ? blockedIpv6(address) : true;
}

async function validateCustomBaseUrl(value: string): Promise<string> {
  if (!value || value.length > 2_048)
    throw new ProviderError('Enter a valid custom endpoint URL.', 400);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderError('Enter a valid custom endpoint URL.', 400);
  }

  if (url.protocol !== 'https:') throw new ProviderError('Custom endpoint must use HTTPS.', 400);
  if (url.username || url.password)
    throw new ProviderError('Custom endpoint cannot contain URL credentials.', 400);
  if (url.search || url.hash)
    throw new ProviderError('Custom endpoint cannot contain a query or fragment.', 400);

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.home.arpa')
  ) {
    throw new ProviderError('Custom endpoint must use a public hostname.', 400);
  }

  if (isIP(hostname)) {
    if (blockedAddress(hostname))
      throw new ProviderError('Private or reserved endpoint addresses are blocked.', 400);
  } else {
    let addresses: { address: string; family: number }[];
    try {
      addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new ProviderError('Custom endpoint hostname could not be resolved.', 400);
    }
    if (!addresses.length || addresses.some((entry) => blockedAddress(entry.address))) {
      throw new ProviderError('Custom endpoint resolves to a private or reserved address.', 400);
    }
  }

  return url.toString().replace(/\/+$/, '');
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
): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(
    () => controller.abort(new DOMException('Provider connect timeout', 'TimeoutError')),
    CONNECT_TIMEOUT_MS,
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
 * context window once the prompt is paid for.
 */
function resolveMaxTokens(request: ChatRequest, ceiling: number): number {
  const requested = request.options?.num_predict;
  // A positive value is the user's explicit choice — pass it through untouched.
  if (typeof requested === 'number' && requested > 0) return Math.min(requested, ceiling);

  const context = request.options?.num_ctx;
  const window = typeof context === 'number' && context > 0 ? context : ASSUMED_CONTEXT;
  const headroom = window - estimatePromptTokens(request);
  return Math.max(OUTPUT_FLOOR, Math.min(ceiling, headroom));
}

function openAiBody(connection: ProviderConnection, request: ChatRequest): Record<string, unknown> {
  const messages = request.messages.map((message) => {
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
  const maxTokens = resolveMaxTokens(request, Number.MAX_SAFE_INTEGER);
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
    const content: AnthropicContent[] = [{ type: 'text', text: message.content }];
    for (const image of message.images ?? []) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: inferImageMediaType(image), data: image },
      });
    }
    const previous = messages.at(-1);
    if (previous?.role === message.role) previous.content.push(...content);
    else messages.push({ role: message.role, content });
  }

  let maxTokens = resolveMaxTokens(request, ANTHROPIC_OUTPUT_CEILING);
  const body: Record<string, unknown> = {
    model: request.model,
    messages,
    stream: request.stream === true,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
  };

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
): ReadableStream<Uint8Array> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let model = fallbackModel;
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  let finished = false;

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
            message?: { model?: string; usage?: { input_tokens?: number } };
            delta?: { type?: string; text?: string; thinking?: string };
            usage?: { output_tokens?: number };
            error?: { message?: string };
          };
          if (data.type === 'error') {
            controller.enqueue(
              ndjson({ error: data.error?.message ?? 'Anthropic stream error.', done: true }),
            );
            finished = true;
            return;
          }
          if (data.message?.model) model = data.message.model;
          if (data.message?.usage?.input_tokens !== undefined) {
            promptTokens = data.message.usage.input_tokens;
          }
          if (data.usage?.output_tokens !== undefined) completionTokens = data.usage.output_tokens;
          if (data.type === 'content_block_delta') {
            const content = data.delta?.type === 'text_delta' ? (data.delta.text ?? '') : '';
            const thinking =
              data.delta?.type === 'thinking_delta' ? (data.delta.thinking ?? '') : '';
            if (content || thinking) {
              controller.enqueue(
                ndjson({ model, message: { role: 'assistant', content, thinking }, done: false }),
              );
            }
          }
          if (data.type === 'message_stop') finish();
          return;
        }

        const data = event as {
          model?: string;
          choices?: {
            delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown };
            finish_reason?: unknown;
          }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
          error?: { message?: string };
        };
        if (data.error?.message) {
          controller.enqueue(ndjson({ error: data.error.message, done: true }));
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
        if (content || thinking) {
          controller.enqueue(
            ndjson({ model, message: { role: 'assistant', content, thinking }, done: false }),
          );
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
    );

  let response = await post(body);
  if (!response.ok) {
    const error = await providerError(response);
    // `resolveMaxTokens` sizes the budget against the context window, which is
    // larger than some models will emit in one reply — those providers reject the
    // request outright instead of clamping. Retry at the ceiling they named, or
    // uncapped if they named none: a shorter answer beats a failed turn.
    if (!rejectsMaxTokens(error)) throw error;
    const field = MAX_TOKEN_FIELDS.find((name) => typeof body[name] === 'number');
    const requested = field ? (body[field] as number) : 0;
    const suggested = field ? suggestedMaxTokens(error.message, requested) : null;
    const relaxed = { ...body };
    if (suggested !== null && field) relaxed[field] = suggested;
    else for (const name of MAX_TOKEN_FIELDS) delete relaxed[name];
    response = await post(relaxed);
    if (!response.ok) throw await providerError(response);
  }

  if (request.stream) {
    if (!response.body) throw new ProviderError('Provider returned no stream body.');
    return new Response(providerStream(response, protocol, request.model), {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-store, no-transform',
        Connection: 'keep-alive',
      },
    });
  }

  const normalized = normalizedNonStream(protocol, await response.json(), request.model);
  return Response.json(normalized, { headers: { 'Cache-Control': 'no-store' } });
}
