'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy } from 'lucide-react';
import { copyText } from '@/lib/utils/clipboard';
import { cn } from '@/lib/utils/cn';

/**
 * Code block wrapper with a language badge and copy button. The inner <code>
 * is already highlighted by rehype-highlight; this adds the chrome.
 *
 * The canvas is a fixed dark colour rather than the field, and it is the one
 * deliberate dark inset in the product: the highlight.js "github-dark" token
 * palette needs a dark ground, and syntax colour is the entire point of a code
 * block. The frame is a 2px off-white rule (see `.code-block`), because the
 * inset itself measures only 2.2:1 against #0000f2 and cannot delineate itself.
 *
 * Foreground alphas are tuned to the inset, not to the field: the label was
 * white at 45% (4.0:1 on #06060d, under AA at 11px) and the copy control at 55%.
 */
export function CodeBlock({
  language,
  raw,
  children,
  className,
}: {
  language?: string;
  raw: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    // `copyText` falls back to a hidden textarea: `navigator.clipboard` is
    // undefined on any non-HTTPS origin, which includes reaching a self-hosted
    // instance over plain HTTP on a LAN address. Failures are now visible instead
    // of the button silently doing nothing.
    const ok = await copyText(raw);
    setCopied(ok);
    setFailed(!ok);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 1600);
  };

  return (
    <div className={cn('code-block group/code', className)}>
      <div className="code-block-header">
        {/* The dot that used to sit here was `bg-accent` and never changed, so it
            read as a status light that reported nothing. A code block has no run
            state; the language is the only fact the header has to carry. */}
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-white/60">
          {language || 'text'}
        </span>
        <button
          onClick={() => void copy()}
          className={cn(
            'focus-ring flex items-center gap-1.5 rounded border border-transparent px-2 py-1 font-mono text-[0.7rem] uppercase tracking-[0.1em] transition-colors duration-fast',
            copied
              ? 'text-success'
              : failed
                ? 'text-error'
                : 'text-white/70 hover:border-white/20 hover:bg-white/[0.09] hover:text-white',
          )}
          aria-label="Copy code"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" /> Copied
            </>
          ) : failed ? (
            <>
              <AlertTriangle className="h-3.5 w-3.5" /> Copy failed
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" /> Copy
            </>
          )}
        </button>
      </div>
      <pre className="scrollbar-thin overflow-x-auto p-4 text-[0.85rem] leading-[1.7] text-white/90">
        {children}
      </pre>
    </div>
  );
}
