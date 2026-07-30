'use client';

import Link from 'next/link';
import { ErrorScreen } from '@/components/ErrorScreen';
import { API_BASE_URL } from '@/lib/api/config';

/** Shown when NEXT_PUBLIC_API_URL is missing or points at localhost. */
export function ApiConfigNotice() {
  return (
    <div className="flex h-full items-center justify-center">
      <ErrorScreen
        title="API endpoint not configured"
        message="This app talks to an external API that forwards to your local Ollama server. Set the NEXT_PUBLIC_API_URL environment variable to a reachable HTTPS endpoint (not localhost) and reload."
      >
        <div className="mt-4 rounded-xl border border-border bg-[rgb(0_0_58_/_0.45)] p-3 text-left">
          <code className="text-xs text-accent-soft">
            NEXT_PUBLIC_API_URL={API_BASE_URL || 'https://my-ollama-api.example.com'}
          </code>
        </div>
        <Link href="/settings" className="btn-surface mx-auto mt-6 h-10 px-5">
          Open settings
        </Link>
      </ErrorScreen>
    </div>
  );
}
