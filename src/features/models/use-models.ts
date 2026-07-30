'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelInfo } from '@/types';
import { fetchModels } from '@/lib/api/client';
import { ApiError, apiConfigured } from '@/lib/api/config';
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
      setError('Set NEXT_PUBLIC_API_URL to a reachable API (not localhost) to load models.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Fetch the raw list and the curated labels in parallel; a labels failure
      // must not block models (the picker just shows raw names).
      const [list, labels] = await Promise.all([
        fetchModels(signal),
        fetchModelLabels(signal),
      ]);
      if (gen !== generation.current) return;
      const merged = applyLabels(list, labels);
      cache = merged;
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

  const reload = useCallback(() => {
    cache = null;
    ownerCache = null;
    void load();
    void fetchIsOwner().then((v) => {
      ownerCache = v;
      setIsOwner(v);
    });
  }, [load]);

  return { models, loading, error, isOwner, reload };
}
