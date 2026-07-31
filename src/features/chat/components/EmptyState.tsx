'use client';

import { m } from 'framer-motion';
import { PROMPT_SUGGESTIONS } from '@/lib/store/defaults';
import { BrandMark } from '@/components/BrandMark';

const PROMPT_CARD_TONES = [
  'prompt-card-paper',
  'prompt-card-coral',
  'prompt-card-sun',
  'prompt-card-sky',
];

export function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="chat-container relative flex min-h-full flex-col justify-center py-10 text-left sm:py-14">
      <div className="lamp-pool left-0 top-4 h-64 w-[min(34rem,90%)] opacity-60" />

      <m.div
        initial={{ opacity: 0, scale: 0.86, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 20 }}
        className="relative z-10 mb-8 flex h-14 w-14 items-center justify-center rounded-lg border border-accent/25 bg-accent/10 text-accent"
      >
        <BrandMark className="h-7 w-7" />
      </m.div>

      {/* Same display face as the landing hero — the empty state is the one place
          in the chat where the headline voice belongs. Two sizes smaller than the
          landing's, because this one has to share a screen with a message list. */}
      <m.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.5 }}
        className="type-display relative z-10 max-w-[24ch] text-[clamp(1.9rem,5.4vw,3.1rem)] text-content"
      >
        What will we make today?
      </m.h1>
      <m.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.5 }}
        className="relative z-10 mt-5 max-w-[52ch] text-[0.95rem] leading-7 text-content-muted"
      >
        Your models, on your machine. Ask a question, or start from one of these.
      </m.p>

      <div className="relative z-10 mt-10 grid w-full grid-flow-dense gap-4 sm:grid-cols-2">
        {PROMPT_SUGGESTIONS.map((s, i) => (
          <m.button
            key={s.title}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.14 + i * 0.055, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            onClick={() => onPick(s.prompt)}
            className={`card edge-lit lift focus-ring group min-h-[8.5rem] p-5 text-left ${PROMPT_CARD_TONES[i]}`}
          >
            <p className="numeral mb-3">{String(i + 1).padStart(2, '0')}</p>
            <p className="type-display text-[1.2rem] text-content">{s.title}</p>
            <p className="mt-2 max-w-[26ch] text-sm leading-5 text-content-muted">{s.subtitle}</p>
          </m.button>
        ))}
      </div>
    </div>
  );
}
