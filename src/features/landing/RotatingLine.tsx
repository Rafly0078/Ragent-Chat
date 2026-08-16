'use client';

import { useEffect, useState } from 'react';

/**
 * The second line of the headline, swapped on a 1.3s beat.
 *
 * Two things make it safe to run on a page that is not allowed to scroll:
 *
 * Every phrase is rendered, invisibly, stacked in one grid cell. The cell is
 * therefore as wide and as tall as the longest phrase at all times, so a swap
 * cannot move the lede, the buttons or the status rail underneath it. Reserving
 * that box in layout rather than measuring it in JS also means the reservation
 * is correct on the very first paint, before this component has hydrated.
 *
 * And each phrase resolves out of the same glyphs the ASCII field behind it is
 * drawn from, locking left to right — the line condenses out of the noise rather
 * than cutting to it. Under `prefers-reduced-motion` there is no decode and no
 * rotation at all: the first phrase is the whole message, and the accessible
 * sentence in the <h1> carries the rest.
 */

/** Read after "your models." — each one has to complete that sentence, and each
 *  one has to stay short enough to hold one line on a 320px screen. */
const PHRASES = [
  'on your machine.',
  'local by default.',
  'private by design.',
  'in one terminal.',
  'on your terms.',
] as const;

const HOLD_MS = 2100;
const DECODE_MS = 240;

/** Resampled on this beat rather than every frame: at 60fps a per-frame reroll
 *  strobes, and the glyphs stop reading as characters at all. */
const RESAMPLE_MS = 48;

/** The field's own vocabulary, minus the heaviest three — at headline size '@'
 *  and '%' read as blocks rather than as a character mid-resolve. */
const NOISE = '.:-=+*/\\<>';

/** What is settled, and what is still resolving. */
type Line = { done: string; ghost: string };

export function RotatingLine() {
  const [index, setIndex] = useState(0);
  // Split rather than one string: the settled half is drawn in the headline's
  // own ink and the half still resolving is drawn dim, so the line reads as text
  // arriving out of the field rather than as a row of punctuation. The two
  // always sum to the phrase's length, so the advance never changes.
  const [line, setLine] = useState<Line>({ done: PHRASES[0], ghost: '' });
  const [still, setStill] = useState(false);
  const [held, setHeld] = useState(false);

  // Resolved after mount: a media query has no answer during SSR, and picking
  // one produces a hydration mismatch on whichever half of visitors it guessed
  // wrong. `false` is the safe pre-mount value because it matches the markup
  // this component renders on the server — the first phrase, undecoded.
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setStill(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  // The beat. WCAG 2.2.2 wants auto-updating content stoppable, so it holds
  // while the line is under the cursor and never starts under reduced motion.
  useEffect(() => {
    if (still || held) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % PHRASES.length), HOLD_MS);
    return () => window.clearInterval(id);
  }, [still, held]);

  useEffect(() => {
    const target = PHRASES[index] ?? PHRASES[0];
    if (still) {
      setLine({ done: target, ghost: '' });
      return;
    }

    let raf = 0;
    let sampledAt = 0;
    let noise = '';
    const startedAt = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / DECODE_MS);
      const settled = Math.round(progress * target.length);

      if (now - sampledAt >= RESAMPLE_MS) {
        sampledAt = now;
        noise = '';
        for (let i = 0; i < target.length; i++) {
          noise += NOISE.charAt((Math.random() * NOISE.length) | 0);
        }
      }

      // Spaces are never scrambled: a word boundary that moves reads as a
      // different phrase rather than as the same phrase resolving.
      let ghost = '';
      for (let i = settled; i < target.length; i++) {
        ghost += target.charAt(i) === ' ' ? ' ' : noise.charAt(i);
      }

      setLine({ done: target.slice(0, settled), ghost });
      if (progress < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [index, still]);

  return (
    <span
      aria-hidden
      className="grid"
      onPointerEnter={(event) => {
        // Touch fires enter with no matching leave, which would hold the beat
        // for the rest of the session on the tap that scrolled nothing.
        if (event.pointerType === 'mouse') setHeld(true);
      }}
      onPointerLeave={() => setHeld(false)}
    >
      {PHRASES.map((phrase) => (
        <span key={phrase} className="invisible col-start-1 row-start-1 whitespace-nowrap">
          <span className="term-prompt">&gt;&nbsp;</span>
          {phrase}
          {/* The caret counts toward the reserved box too, or the cell would
              breathe by its width on whichever phrase happens to be longest. */}
          <span className="term-caret" />
        </span>
      ))}
      <span className="col-start-1 row-start-1 whitespace-nowrap">
        <span className="term-prompt">&gt;&nbsp;</span>
        {line.done}
        <span className="term-ghost">{line.ghost}</span>
        <span className="term-caret animate-caret-blink" />
      </span>
    </span>
  );
}
