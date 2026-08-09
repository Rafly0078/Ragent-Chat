'use client';

import Link from 'next/link';
import { ErrorScreen } from '@/components/ErrorScreen';
import { API_BASE_URL } from '@/lib/api/config';
import { useSettings } from '@/lib/store/settings-store';
import { providerLabel } from '@/lib/providers/types';

/** Shown when the selected provider has no usable configuration. */
export function ApiConfigNotice() {
  const provider = useSettings((state) => state.apiProvider);
  const cloud = provider !== 'ollama';
  // 'default' only lands here when the deployment never set the built-in
  // provider up — a server-side gap the visitor can do nothing about, so point
  // them at the providers they *can* configure instead.
  const builtIn = provider === 'default';
  return (
    <div className="flex h-full items-center justify-center">
      <ErrorScreen
        title={builtIn ? 'Built-in provider unavailable' : 'API endpoint not configured'}
        message={
          builtIn
            ? 'This deployment has no built-in provider configured. Choose Ollama or your own cloud API in Settings.'
            : cloud
              ? `Finish the ${providerLabel(provider)} endpoint and API key setup in Settings.`
              : 'Set a reachable Ollama URL, or enable the server bridge, in Settings.'
        }
      >
        <div className="mt-4 rounded-xl border border-border/15 bg-surface p-3 text-left">
          <code className="text-xs text-accent-soft">
            {builtIn
              ? 'DEFAULT_OPENAI_ENDPOINT is unset on the server'
              : cloud
                ? `${providerLabel(provider)} configuration incomplete`
                : `NEXT_PUBLIC_API_URL=${API_BASE_URL || 'https://my-ollama-api.example.com'}`}
          </code>
        </div>
        <Link href="/settings" className="btn-surface mx-auto mt-6 h-10 px-5">
          Open settings
        </Link>
      </ErrorScreen>
    </div>
  );
}
