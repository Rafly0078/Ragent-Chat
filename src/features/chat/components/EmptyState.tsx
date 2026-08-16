'use client';

import { PROMPT_SUGGESTIONS } from '@/lib/store/defaults';
import { BrandMark } from '@/components/BrandMark';

/**
 * The state a new conversation opens in.
 *
 * The suggestions used to be a two-column grid with the first card spanning two
 * rows, which only resolved cleanly at exactly three entries — with the four in
 * `PROMPT_SUGGESTIONS` it produced a third row holding one orphan and one hole.
 * A single-column list is right for a transcript anyway: it is the same
 * hairline-separated rhythm the turns above it will have, and it works at any
 * count.
 */
export function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="chat-container relative flex min-h-full flex-col justify-center py-12 sm:py-16">
      <span
        className="enter flex items-center gap-2.5 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-content-subtle"
        style={{ animationDelay: '40ms' }}
      >
        <BrandMark className="h-3.5 w-3.5" /> new session
      </span>

      <h1
        className="enter mt-5 font-mono text-[clamp(1.5rem,4vw,2.3rem)] font-semibold leading-[1.15] tracking-[-0.03em] text-content"
        style={{ animationDelay: '90ms' }}
      >
        ask it something.
      </h1>

      <p
        className="enter mt-4 max-w-[54ch] text-[0.95rem] leading-7 text-content-muted"
        style={{ animationDelay: '140ms' }}
      >
        Local Ollama or the cloud key you choose. Every prompt goes only to the backend you point it
        at.
      </p>

      <ul className="enter mt-9 border-t border-border/15" style={{ animationDelay: '200ms' }}>
        {PROMPT_SUGGESTIONS.map((s, i) => (
          <li key={s.title}>
            <button
              onClick={() => onPick(s.prompt)}
              className="focus-ring group flex w-full items-baseline gap-4 border-b border-border/15 py-3.5 text-left transition-colors duration-fast hover:bg-border/[0.05]"
            >
              <span className="shrink-0 font-mono text-[0.68rem] tabular-nums text-content-subtle">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-[0.85rem] text-content">{s.title}</span>
                <span className="mt-1 block text-sm leading-5 text-content-muted">
                  {s.subtitle}
                </span>
              </span>
              <span
                aria-hidden
                className="shrink-0 text-content-subtle opacity-0 transition-opacity duration-fast group-hover:opacity-100"
              >
                &rarr;
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
