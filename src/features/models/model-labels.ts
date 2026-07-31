'use client';

/**
 * Client helpers for owner-curated model labels. These talk to the same-origin
 * /api/model-labels routes (not Ollama), so they work regardless of the
 * direct/bridge connection mode used for chat.
 */

export interface ModelLabel {
  modelName: string;
  displayName: string;
  description: string | null;
  hidden: boolean;
  sortOrder: number;
}

interface RawLabel {
  model_name: string;
  display_name: string;
  description: string | null;
  hidden: boolean;
  sort_order: number;
}

function fromRaw(r: RawLabel): ModelLabel {
  return {
    modelName: r.model_name,
    displayName: r.display_name,
    description: r.description,
    hidden: r.hidden,
    sortOrder: r.sort_order,
  };
}

/** Public: fetch all curated labels. Returns [] on any failure (names degrade to raw). */
export async function fetchModelLabels(signal?: AbortSignal): Promise<ModelLabel[]> {
  try {
    const res = await fetch('/api/model-labels', {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { labels?: RawLabel[] };
    return (data.labels ?? []).map(fromRaw);
  } catch {
    return [];
  }
}

/** Whether the current user may edit labels (drives edit-UI visibility only). */
export async function fetchIsOwner(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch('/api/model-labels/is-owner', { signal });
    if (!res.ok) return false;
    const data = (await res.json()) as { isOwner?: boolean };
    return Boolean(data.isOwner);
  } catch {
    return false;
  }
}

export interface SaveLabelInput {
  modelName: string;
  displayName: string;
  description?: string | null;
  hidden?: boolean;
}

/** Owner-only: upsert a label. Throws with a message on failure. */
export async function saveModelLabel(input: SaveLabelInput): Promise<ModelLabel> {
  const res = await fetch('/api/model-labels', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => ({}))) as { label?: RawLabel; error?: string };
  if (!res.ok || !data.label) {
    throw new Error(data.error ?? 'Failed to save the model name.');
  }
  return fromRaw(data.label);
}

/** Owner-only: remove a label so the model reverts to its raw name. */
export async function deleteModelLabel(modelName: string): Promise<void> {
  const res = await fetch(`/api/model-labels?modelName=${encodeURIComponent(modelName)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? 'Failed to remove the model name.');
  }
}
