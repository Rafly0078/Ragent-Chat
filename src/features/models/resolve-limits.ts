'use client';

import type { GenerationParams } from '@/types';
import { getApiProvider } from '@/lib/api/config';
import {
  contextLengthSource,
  resolveContextLength,
  resolveMaxOutputTokens,
  type LimitSource,
} from '@/lib/providers/limits';
import { getCachedModel, useModelsCacheVersion } from './use-models';

export interface ResolvedLimits {
  /** The window to actually send as `num_ctx`. */
  contextLength: number;
  /** The ceiling to actually send as `num_predict`. */
  maxTokens: number;
  /** True when `contextLength` came from the model/provider, not the slider. */
  contextAuto: boolean;
  maxTokensAuto: boolean;
  /** Where the auto value came from, for the hint under the slider. */
  contextSource: LimitSource;
}

/**
 * Turn stored params into the numbers to send for a given model.
 *
 * `contextAuto` / `maxTokensAuto` are opt-*out* flags: undefined counts as on,
 * so conversations created before auto existed follow the model too, and a user
 * who drags the slider sets them false and keeps their number from then on.
 * When auto is on but nothing can be resolved (an unknown custom endpoint), the
 * stored number is used unchanged — auto never makes the app worse off than the
 * manual value it replaces.
 */
export function resolveLimits(params: GenerationParams, model: string): ResolvedLimits {
  const provider = getApiProvider();
  const info = getCachedModel(model);

  const contextAuto = params.contextAuto !== false;
  const maxTokensAuto = params.maxTokensAuto !== false;

  const resolvedContext = contextAuto
    ? resolveContextLength(provider, model, info?.contextLength)
    : null;
  const resolvedMax = maxTokensAuto
    ? resolveMaxOutputTokens(provider, model, info?.maxOutputTokens)
    : null;

  return {
    contextLength: resolvedContext ?? params.contextLength,
    maxTokens: resolvedMax ?? params.maxTokens,
    contextAuto: contextAuto && resolvedContext != null,
    maxTokensAuto: maxTokensAuto && resolvedMax != null,
    contextSource:
      contextAuto && resolvedContext != null
        ? contextLengthSource(provider, model, info?.contextLength)
        : 'manual',
  };
}

/**
 * `resolveLimits` for use during render.
 *
 * Same result, but subscribed to the model cache: the cache is filled by an
 * async fetch, so a component that resolved limits on its first render would
 * otherwise keep displaying the fallback number after the real window arrived.
 */
export function useResolvedLimits(params: GenerationParams, model: string): ResolvedLimits {
  useModelsCacheVersion();
  return resolveLimits(params, model);
}

/** Human label for the hint line under the context slider. */
export function limitSourceLabel(source: LimitSource): string {
  switch (source) {
    case 'endpoint':
      return 'reported by the endpoint';
    case 'model':
      return "this model's known window";
    case 'provider':
      return 'provider default';
    default:
      return 'set manually';
  }
}
