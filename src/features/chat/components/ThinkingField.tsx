'use client';

import { useEffect, useRef } from 'react';
import { mountAscii } from '@/lib/ascii/engine';
import { flowPreset } from '@/lib/ascii/flow';
import config from '../thinking-ascii.json';

/**
 * What the model thinks inside: the `flow` preset from `thinking-ascii.json`,
 * clipped to the brand mark, with the lamp still lit at its centre.
 *
 * It replaces a 3px bar that swept under the word "Thinking" — and replaces the
 * label too, which used to say "Thinking" whenever no text had landed yet whether
 * or not thinking was even enabled. The caller passes what is actually happening.
 *
 * Mounted only while the model is working. Everything about the loop lives in
 * `lib/ascii/engine`, including the single static frame under
 * `prefers-reduced-motion` — the reduced-motion block in globals.css collapses CSS
 * animation and cannot reach a canvas.
 *
 * It deliberately takes no props that change during a turn. The row it sits in
 * re-renders on every animation frame while a message streams, so anything driven
 * from React props here would fight the rAF loop rather than feed it.
 */
export function ThinkingField({ label }: { label: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // A fresh preset per mount: it carries per-row state between the engine's
    // `row` and `cell` calls, so two canvases must not share one.
    return mountAscii(canvas, flowPreset(config));
  }, []);

  return (
    <span role="status" className="thinking-field">
      <canvas ref={ref} aria-hidden className="thinking-canvas" />
      <span className="thinking-label">{label}</span>
    </span>
  );
}
