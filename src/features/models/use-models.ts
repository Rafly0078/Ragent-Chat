'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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

/**
 * The requests in flight, not just their results.
 *
 * `if (!cache)` only dedupes a *resolved* cache, so ChatView and the picker —
 * which mount in the same commit on /chat — each fired their own /api/models,
 * /api/model-labels and is-owner round trip at the user's own server.
 *
 * Neither shared request takes a caller's AbortSignal, deliberately: one
 * component unmounting must not cancel the fetch another is waiting on. For the
 * owner check that also retires the old hazard where `fetchIsOwner` swallowed the
 * AbortError as `false` and cached "not the owner" for the rest of the session.
 */
let inflight: Promise<ModelInfo[]> | null = null;
let ownerInflight: Promise<boolean> | null = null;

function loadOnce(): Promise<ModelInfo[]> {
  if (!inflight) {
    // The raw list and the curated labels in parallel; a labels failure must not
    // block models (the picker just shows raw names).
    const pending: Promise<ModelInfo[]> = Promise.all([fetchModels(), fetchModelLabels()])
      .then(([list, labels]) => applyLabels(list, labels))
      // Cleared only if it is still the current request: a reload replaces
      // `inflight`, and the superseded one must not clear its successor.
      .finally(() => {
        if (inflight === pending) inflight = null;
      });
    inflight = pending;
  }
  return inflight;
}

function checkOwnerOnce(): Promise<boolean> {
  if (!ownerInflight) {
    const pending: Promise<boolean> = fetchIsOwner()
      .then((v) => {
        ownerCache = v;
        return v;
      })
      .finally(() => {
        if (ownerInflight === pending) ownerInflight = null;
      });
    ownerInflight = pending;
  }
  return ownerInflight;
}

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
 * `display_name`, flag the ones marked `hidden`, and re-sort so curated models
 * lead (by sort_order, then label). Models without a label keep their raw name.
 *
 * A hidden model is flagged here, not dropped. Dropping it took it away from the
 * owner too — and the editor that can un-hide one is only reachable from that
 * model's own row in the picker, so "Hide from list" was a door that locked behind
 * you and only a DELETE against `model_labels` reopened.
 */
function applyLabels(models: ModelInfo[], labels: ModelLabel[]): ModelInfo[] {
  if (labels.length === 0) return models;
  const byName = new Map(labels.map((l) => [l.modelName, l]));
  const out: ModelInfo[] = [];
  for (const model of models) {
    const label = byName.get(model.name);
    if (label) {
      out.push({
        ...model,
        label: label.displayName,
        customLabel: true,
        description: label.description ?? undefined,
        hidden: label.hidden,
      });
    } else {
      out.push(model);
    }
  }
  out.sort((a, b) => {
    // Hidden entries sink to the end. They are only in this list for the owner,
    // and the picker auto-selects `models[0]` — which must never be a model the
    // owner has taken out of circulation.
    if (Boolean(a.hidden) !== Boolean(b.hidden)) return a.hidden ? 1 : -1;
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

  const load = useCallback(async () => {
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
      const merged = await loadOnce();
      if (gen !== generation.current) return;
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
    if (!cache) void load();
    if (ownerCache === null) void checkOwnerOnce().then((v) => setIsOwner(v));
  }, [load]);

  useEffect(() => {
    const onConfigChanged = () => {
      setCache(null);
      // The list in flight was fetched against the old configuration.
      inflight = null;
      setModels([]);
      void load();
    };
    window.addEventListener(API_CONFIG_CHANGED_EVENT, onConfigChanged);
    return () => window.removeEventListener(API_CONFIG_CHANGED_EVENT, onConfigChanged);
  }, [load]);

  const reload = useCallback(() => {
    setCache(null);
    ownerCache = null;
    // Otherwise Reload would resolve from the request it is meant to replace.
    inflight = null;
    ownerInflight = null;
    void load();
    void checkOwnerOnce().then((v) => setIsOwner(v));
  }, [load]);

  /**
   * Hidden models stay loaded but are shown only to the owner — the one user who
   * can un-hide them, and the one who used to lose the row (and with it the
   * editor) the instant they flipped the switch.
   */
  const visible = useMemo(
    () => (isOwner ? models : models.filter((model) => !model.hidden)),
    [models, isOwner],
  );

  return { models: visible, loading, error, isOwner, reload };
}
