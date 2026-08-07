'use client';

import { useCallback, useState } from 'react';
import { ApiError, apiUrl, authHeaders } from '@/lib/api/config';

export interface ModelDetails {
  name: string;
  family: string[];
  parameter_size: string;
  quantization_level: string;
  format: string;
  template: string;
  modelfile: string;
  license: string;
  capabilities?: string[];
  parameters: string;
}

interface UseModelDetailsState {
  details: ModelDetails | null;
  loading: boolean;
  error: string | null;
}

export function useModelDetails() {
  const [state, setState] = useState<UseModelDetailsState>({
    details: null,
    loading: false,
    error: null,
  });

  const fetchDetails = useCallback(async (modelName: string, signal?: AbortSignal) => {
    setState({ details: null, loading: true, error: null });
    try {
      const res = await fetch(apiUrl('/api/show'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ name: modelName }),
        signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Failed to fetch model details' }));
        throw new ApiError(body.error ?? 'Failed to fetch model details', {
          kind: 'http',
          status: res.status,
        });
      }
      const data = (await res.json()) as ModelDetails;
      setState({ details: data, loading: false, error: null });
    } catch (err) {
      if (err instanceof ApiError && err.kind === 'aborted') return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setState({
        details: null,
        loading: false,
        error: err instanceof ApiError ? err.userMessage : 'Failed to load model details.',
      });
    }
  }, []);

  return { ...state, fetchDetails };
}
