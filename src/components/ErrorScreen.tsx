'use client';

import { m } from 'framer-motion';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export function ErrorScreen({
  title = 'Something went wrong',
  message,
  onRetry,
  children,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-6 text-center">
      <m.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass max-w-md rounded-2xl p-8 shadow-float"
      >
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-lg border border-warning/25 bg-warning/10">
          <AlertTriangle className="h-7 w-7 text-warning" />
        </div>
        <h2 className="type-display text-[1.35rem] text-content">{title}</h2>
        <p className="mt-2.5 text-sm leading-6 text-content-muted">{message}</p>
        {children}
        {onRetry && (
          <button onClick={onRetry} className="btn-primary btn-lg mx-auto mt-7">
            <RefreshCw className="h-4 w-4" /> Try again
          </button>
        )}
      </m.div>
    </div>
  );
}
