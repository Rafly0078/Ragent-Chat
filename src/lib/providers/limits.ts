import type { ApiProvider } from './types';

/**
 * Context-window resolution.
 *
 * The app used to send whatever number the context-length slider held, which
 * was wrong in both directions: 131072 truncated a 200k Claude conversation
 * early, and the same number overflowed an 8k local model. This module answers
 * "how big is the window actually?" from the best source available, in order:
 *
 *   1. what the endpoint itself reported for the model (`ModelInfo.contextLength`,
 *      e.g. Ollama's /api/show or an OpenAI-shaped /models entry that happens to
 *      carry `context_length`),
 *   2. a per-provider default for the well-known hosted APIs, whose /models
 *      responses do NOT carry a window at all,
 *   3. a name-based guess for the handful of families whose window is common
 *      knowledge but whose provider default would understate it,
 *   4. the user's own number from the slider.
 *
 * Pure data + pure functions: no network, no React, no store access, so both
 * the params panel and the send path can call it.
 */

/**
 * Per-provider context windows, used when the endpoint doesn't report one.
 * Deliberately the *conservative* figure for each provider's mainstream models
 * — overshooting causes upstream 400s, undershooting only compacts earlier.
 */
const PROVIDER_CONTEXT: Partial<Record<ApiProvider, number>> = {
  openai: 128_000,
  anthropic: 200_000,
  deepseek: 128_000,
  groq: 128_000,
  openrouter: 128_000,
};

/** Per-provider output ceilings. Anthropic's is enforced server-side too. */
const PROVIDER_MAX_OUTPUT: Partial<Record<ApiProvider, number>> = {
  openai: 32_768,
  anthropic: 64_000,
  deepseek: 8_192,
  groq: 32_768,
  openrouter: 32_768,
};

/**
 * Name-based overrides for families whose window is materially larger than
 * their provider's conservative default. Matched against the lowercased model
 * id, first hit wins — so order matters, most specific first.
 */
const MODEL_CONTEXT_PATTERNS: { pattern: RegExp; context: number }[] = [
  { pattern: /gemini-[\d.]+-(pro|flash)/, context: 1_000_000 },
  { pattern: /gpt-(4\.1|5)/, context: 1_000_000 },
  { pattern: /claude-(opus|sonnet)-[45]/, context: 200_000 },
  { pattern: /claude-3[.-]/, context: 200_000 },
  { pattern: /(llama-?4|scout|maverick)/, context: 256_000 },
  { pattern: /qwen3?[.-]?(max|next|coder)/, context: 256_000 },
  { pattern: /minimax-m[12]/, context: 1_000_000 },
  { pattern: /grok-[34]/, context: 256_000 },
  { pattern: /deepseek-(v3|r1|chat|reasoner)/, context: 128_000 },
  { pattern: /kimi-k[12]/, context: 200_000 },
  { pattern: /glm-[45]/, context: 200_000 },
];

/** Floor for an auto-resolved window — below this, compaction thrashes. */
const MIN_CONTEXT = 2_048;

/**
 * Resolve the context window to send for a model, or `null` when nothing but
 * the user's own number is available.
 *
 * `reported` is whatever the endpoint said (may be undefined). It always wins:
 * a self-hosted 8k model must not be handed a 128k provider default just
 * because it is served over an OpenAI-compatible URL.
 */
export function resolveContextLength(
  provider: ApiProvider,
  model: string,
  reported?: number,
): number | null {
  if (typeof reported === 'number' && reported >= MIN_CONTEXT) return Math.floor(reported);

  const name = model.toLowerCase();
  const matched = MODEL_CONTEXT_PATTERNS.find((entry) => entry.pattern.test(name));
  if (matched) return matched.context;

  return PROVIDER_CONTEXT[provider] ?? null;
}

/**
 * Resolve the output-token ceiling, or `null` when unknown. `-1` (the app's
 * "let the server decide" sentinel) is a perfectly good answer for providers
 * with no published ceiling, so callers keep the user's value in that case.
 */
export function resolveMaxOutputTokens(
  provider: ApiProvider,
  model: string,
  reported?: number,
): number | null {
  if (typeof reported === 'number' && reported > 0) return Math.floor(reported);
  return PROVIDER_MAX_OUTPUT[provider] ?? null;
}

/** Where a resolved number came from — shown as a hint under the slider. */
export type LimitSource = 'endpoint' | 'model' | 'provider' | 'manual';

export function contextLengthSource(
  provider: ApiProvider,
  model: string,
  reported?: number,
): LimitSource {
  if (typeof reported === 'number' && reported >= MIN_CONTEXT) return 'endpoint';
  if (MODEL_CONTEXT_PATTERNS.some((entry) => entry.pattern.test(model.toLowerCase())))
    return 'model';
  return PROVIDER_CONTEXT[provider] != null ? 'provider' : 'manual';
}
