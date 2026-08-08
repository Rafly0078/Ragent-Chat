'use client';

import Link from 'next/link';
import { ErrorScreen } from '@/components/ErrorScreen';
import { API_BASE_URL } from '@/lib/api/config';
import { useSettings } from '@/lib/store/settings-store';
import { providerLabel } from '@/lib/providers/types';

/** Shown when NEXT_PUBLIC_API_URL is missing or points at localhost. */
export function ApiConfigNotice() {
  const provider = useSettings((state) => state.apiProvider);
  const cloud = provider !== 'ollama';
  return (
    <div className="flex h-full items-center justify-center">
      <ErrorScreen
        title="API endpoint not configured"
        message={
          cloud
            ? `Finish the ${providerLabel(provider)} endpoint and API key setup in Settings.`
            : 'Set a reachable Ollama URL, or enable the server bridge, in Settings.'
        }
      >
        <div className="mt-4 rounded-xl border border-border/15 bg-surface p-3 text-left">
          <code className="text-xs text-accent-soft">
            {cloud
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
