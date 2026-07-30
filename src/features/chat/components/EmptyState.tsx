'use client';

import { m } from 'framer-motion';
import { PROMPT_SUGGESTIONS } from '@/lib/store/defaults';

const PROMPT_CARD_TONES = ['prompt-card-paper', 'prompt-card-coral', 'prompt-card-sun', 'prompt-card-sky'];

export function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="chat-container flex min-h-full flex-col justify-center py-8 text-left sm:py-12">
      <m.div
        initial={{ opacity: 0, scale: 0.8, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 18 }}
        className="accent-gradient mb-7 flex h-16 w-16 items-center justify-center rounded"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/noun-heart-8300361 (1).png" alt="" width={24} height={24} className="h-6 w-6" />
      </m.div>
      {/* Same display face and stacked leading as the landing hero — the empty
          state is the one place in the chat where the headline voice belongs. */}
      <m.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="type-display max-w-4xl text-[clamp(2.25rem,7vw,4rem)] text-content"
      >
        What will we make today?
      </m.h1>
      <p className="mt-6 max-w-xl text-base leading-7 text-content-muted">
        Your models. Your machine. Your private workspace for asking, making, and figuring things out.
      </p>

      <div className="mt-10 grid w-full grid-flow-dense gap-4 sm:grid-cols-2">
        {PROMPT_SUGGESTIONS.map((s, i) => (
          <m.button
            key={s.title}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.05 }}
            onClick={() => onPick(s.prompt)}
            className={`focus-ring group min-h-32 border-2 border-content/25 p-5 text-left transition-colors hover:border-content/60 ${PROMPT_CARD_TONES[i]}`}
          >
            <p className="type-label mb-2 text-acid">{`0${i + 1}`}</p>
            <p className="type-display text-[1.35rem] text-content">{s.title}</p>
            <p className="mt-2 max-w-[25ch] text-sm leading-5 text-content-muted">{s.subtitle}</p>
          </m.button>
        ))}
      </div>
    </div>
  );
}
