'use client';

import { PROMPT_SUGGESTIONS } from '@/lib/store/defaults';
import { BrandMark } from '@/components/BrandMark';

export function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="chat-container relative flex min-h-full flex-col justify-center py-12 text-left sm:py-16">
      <div className="lamp-pool left-0 top-4 h-64 w-[min(34rem,90%)] opacity-70" />

      <div
        className="enter relative z-10 mb-7 flex h-12 w-12 items-center justify-center rounded-md bg-accent text-accent-fg"
        style={{ animationDelay: '40ms' }}
      >
        <BrandMark className="h-6 w-6" />
      </div>

      <h1
        className="type-mega enter relative z-10 max-w-[12ch] text-[clamp(2rem,5.5vw,3.6rem)] text-content"
        style={{ animationDelay: '90ms' }}
      >
        Start with a clear question.
      </h1>
      <p
        className="enter relative z-10 mt-5 max-w-[52ch] text-[0.95rem] leading-7 text-content-muted"
        style={{ animationDelay: '140ms' }}
      >
        Your models, on your machine. Choose a starting point or write your own.
      </p>

      <div className="border-border/16 relative z-10 mt-10 grid gap-0 border-y sm:grid-cols-[1.1fr_0.9fr] sm:gap-x-8">
        {PROMPT_SUGGESTIONS.map((s, i) => (
          <button
            key={s.title}
            onClick={() => onPick(s.prompt)}
            className={`enter border-border/12 focus-ring group flex min-h-[5.5rem] items-start gap-4 border-b py-5 text-left transition-colors duration-fast hover:bg-content/[0.035] sm:last:border-b-0 ${
              i === 0
                ? 'sm:row-span-2 sm:min-h-[11rem] sm:flex-col sm:justify-end sm:border-b-0 sm:border-r sm:pr-8'
                : 'sm:pl-1'
            }`}
            style={{ animationDelay: `${190 + i * 60}ms` }}
          >
            <span className="numeral shrink-0 text-content-subtle">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="min-w-0">
              <span className="type-display block text-[1.05rem] text-content transition-colors duration-fast group-hover:text-accent">
                {s.title}
              </span>
              <span className="mt-1.5 block text-sm leading-5 text-content-muted">
                {s.subtitle}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
