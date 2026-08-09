'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ModelInfo } from '@/types';
import { fetchModels } from '@/lib/api/client';
import {
  API_CONFIG_CHANGED_EVENT,
  ApiError,
  apiConfigured,
  getApiProvider,
} from '@/lib/api/config';
import { providerLabel } from '@/lib/providers/types';
import { fetchModelLabels, fetchIsOwner, type ModelLabel } from './model-labels';

interface ModelsState {
  models: ModelInfo[];
  loading: boolean;
  error: string | null;
  /** True when the current user may curate model display names. */
  isOwner: boolean;
  reload: () => void;
}

// Module-level cache so switching routes doesn't refetch every mount.
let cache: ModelInfo[] | null = null;
let ownerCache: boolean | null = null;

// Bumped on every cache write so components reading the cache synchronously can
// re-render when it fills. Without this, anything resolved from `getCachedModel`
// during the first render (the context meter, the params panel) stayed on its
// fallback until an unrelated state change happened to re-render it.
let cacheVersion = 0;
const cacheListeners = new Set<() => void>();

function setCache(next: ModelInfo[] | null): void {
  cache = next;
  cacheVersion++;
  for (const listener of cacheListeners) listener();
}

function subscribeToCache(listener: () => void): () => void {
  cacheListeners.add(listener);
  return () => cacheListeners.delete(listener);
}

/**
 * Re-render the caller whenever the model cache changes.
 *
 * Returns an opaque version number — the value is meaningless, the point is
 * that reading it subscribes the component. Callers pair it with
 * `getCachedModel` to read fresh metadata on each render.
 */
export function useModelsCacheVersion(): number {
  return useSyncExternalStore(
    subscribeToCache,
    () => cacheVersion,
    // The server render has no cache; pinning the snapshot to 0 keeps it stable
    // and avoids a hydration mismatch if a client load already landed.
    () => 0,
  );
}

/**
 * Synchronous read of an already-loaded model's metadata.
 *
 * The send path and the params panel both need the model's reported context
 * window, and neither can await a fetch: the first runs inside a keystroke
 * handler, the second inside render. They read this cache instead — it is
 * populated by `load()` below, and returns undefined until the picker has
 * loaded once, which every caller treats as "no reported limit".
 */
export function getCachedModel(name: string): ModelInfo | undefined {
  if (!name) return undefined;
  return cache?.find((model) => model.name === name);
}

/**
 * Overlay owner-curated labels onto the raw model list: rename via
 * `display_name`, drop entries flagged `hidden`, and re-sort so curated models
 * lead (by sort_order, then label). Models without a label keep their raw name.
 */
function applyLabels(models: ModelInfo[], labels: ModelLabel[]): ModelInfo[] {
  if (labels.length === 0) return models;
  const byName = new Map(labels.map((l) => [l.modelName, l]));
  const out: ModelInfo[] = [];
  for (const model of models) {
    const label = byName.get(model.name);
    if (label?.hidden) continue;
    if (label) {
      out.push({
        ...model,
        label: label.displayName,
        customLabel: true,
        description: label.description ?? undefined,
      });
    } else {
      out.push(model);
    }
  }
  out.sort((a, b) => {
    const la = byName.get(a.name);
    const lb = byName.get(b.name);
    const oa = la?.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const ob = lb?.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
    return a.label.localeCompare(b.label);
  });
  return out;
}

export function useModels(): ModelsState {
  const [models, setModels] = useState<ModelInfo[]>(cache ?? []);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState<boolean>(ownerCache ?? false);
  /** Only the newest load may clear `loading` or write results. */
  const generation = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const gen = ++generation.current;
    if (!apiConfigured()) {
      const provider = getApiProvider();
      setError(
        provider === 'ollama'
          ? 'Set a reachable Ollama URL or enable the server bridge to load models.'
          : `Finish ${providerLabel(provider)} configuration to load models.`,
      );
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Fetch the raw list and the curated labels in parallel; a labels failure
      // must not block models (the picker just shows raw names).
      const [list, labels] = await Promise.all([fetchModels(signal), fetchModelLabels(signal)]);
      if (gen !== generation.current) return;
      const merged = applyLabels(list, labels);
      setCache(merged);
      setModels(merged);
    } catch (err) {
      if (err instanceof ApiError && err.kind === 'aborted') return;
      if (gen !== generation.current) return;
      setError(err instanceof ApiError ? err.userMessage : 'Failed to load models.');
    } finally {
      // Guarded: an aborted or superseded load used to flip `loading` off while a
      // newer request was still in flight, so the picker showed "No models found"
      // instead of the skeleton.
      if (gen === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    if (!cache) void load(ctrl.signal);
    if (ownerCache === null) {
      void fetchIsOwner(ctrl.signal).then((v) => {
        // `fetchIsOwner` swallows AbortError and returns false, so an unmount
        // before the request settled used to cache `false` permanently — the
        // owner's rename controls then never appeared again until a full reload.
        if (ctrl.signal.aborted) return;
        ownerCache = v;
        setIsOwner(v);
      });
    }
    return () => ctrl.abort();
  }, [load]);

  useEffect(() => {
    const onConfigChanged = () => {
      setCache(null);
      setModels([]);
      void load();
    };
    window.addEventListener(API_CONFIG_CHANGED_EVENT, onConfigChanged);
    return () => window.removeEventListener(API_CONFIG_CHANGED_EVENT, onConfigChanged);
  }, [load]);

  const reload = useCallback(() => {
    setCache(null);
    ownerCache = null;
    void load();
    void fetchIsOwner().then((v) => {
      ownerCache = v;
      setIsOwner(v);
    });
  }, [load]);

  return { models, loading, error, isOwner, reload };
}
