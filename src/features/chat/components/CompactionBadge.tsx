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
 *
 * It sits on `.chat-container` like every other row. It used to carry its own
 * `max-w-3xl`, 92px narrower than the column it divides, so the one element whose
 * whole job is to draw a line across the transcript stopped short of both edges.
 */
export function CompactionBadge({ text, createdAt }: { text: string; createdAt: number }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="chat-container py-3">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border/25" />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="focus-ring inline-flex items-center gap-1.5 rounded-sm font-mono text-[0.66rem] uppercase tracking-[0.12em] text-content-subtle transition-colors hover:text-content"
        >
          <Archive className="h-3 w-3" aria-hidden />
          compacted
          <span className="opacity-60">· {relativeTime(createdAt)}</span>
          <ChevronDown
            className={cn('h-3 w-3 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </button>
        <div className="h-px flex-1 bg-border/25" />
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <div className="reason mt-3">
              <p className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-content-subtle">
                summary the model still uses
              </p>
              <p className="reason-text">{text}</p>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
