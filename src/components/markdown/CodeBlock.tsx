'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy } from 'lucide-react';
import { copyText } from '@/lib/utils/clipboard';
import { cn } from '@/lib/utils/cn';

/**
 * Code block wrapper with a language badge and copy button. The inner <code>
 * is already highlighted by rehype-highlight; this adds the chrome.
 *
 * The canvas is a fixed dark colour (not theme-driven) because the
 * highlight.js "github-dark" token palette is only legible on a dark
 * background — letting it inherit the light/paper theme's surface color
 * used to wash the syntax colours out. Only the outer frame (border +
 * shadow) follows the app theme, so the block still reads as one of the
 * app's brutalist cards in both light and dark mode.
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
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-white/45">
            {language || 'text'}
          </span>
        </div>
        <button
          onClick={() => void copy()}
          className={cn(
            'focus-ring flex items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-xs transition-colors',
            copied
              ? 'text-success'
              : failed
                ? 'text-error'
                : 'text-white/55 hover:border-white/[0.12] hover:bg-white/[0.07] hover:text-white/90'
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
