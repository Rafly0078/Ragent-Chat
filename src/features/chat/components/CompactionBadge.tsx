'use client';

import { useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { Archive, ChevronDown } from 'lucide-react';
import { relativeTime } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

/**
 * Inline marker shown at the point where earlier messages were condensed into a
 * running summary to stay within the model's context window. Rendered right
 * after the last message the summary covers. Click to reveal the summary text
 * itself, so the memory the model still uses stays inspectable.
 */
export function CompactionBadge({ text, createdAt }: { text: string; createdAt: number }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mx-auto max-w-3xl px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border/60" />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/15 bg-surface px-2.5 py-1 text-xs font-medium text-content-subtle transition-colors hover:text-content"
        >
          <Archive className="h-3 w-3" aria-hidden />
          Context compacted
          <span className="text-content-subtle/70">· {relativeTime(createdAt)}</span>
          <ChevronDown
            className={cn('h-3 w-3 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </button>
        <div className="h-px flex-1 bg-border/60" />
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <m.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-3 rounded-xl border border-border/15 bg-surface-raised p-3 text-sm text-content-subtle">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-content-subtle/70">
                Summary the model still uses
              </p>
              <p className="whitespace-pre-wrap">{text}</p>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
