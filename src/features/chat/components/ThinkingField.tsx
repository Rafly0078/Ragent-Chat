'use client';

import { useEffect, useRef } from 'react';
import { mountAscii } from '@/lib/ascii/engine';
import { flowPreset } from '@/lib/ascii/flow';
import config from '../thinking-ascii.json';

/**
 * What the model thinks inside: the word THINKING, filled with the `flow` preset
 * from `thinking-ascii.json`.
 *
 * `logoMask: true` in that file means the glyph pass is clipped to a silhouette,
 * and the silhouette is a raster — so it is a `mask-image` rather than a `Path2D`.
 * The browser scales and composites it at native resolution for nothing, the canvas
 * only has to fill its box, and the letter edges stay crisp while glyphs are cut
 * mid-stroke, which is what makes it read as a word rather than as a stencil.
 *
 * It runs at the reading column's full width. The wordmark is 12:1, so at ~740px
 * the letter strokes are about three glyph cells across — the floor for a run of
 * glyphs to state a direction at all. Narrower than that (a phone) the flow becomes
 * a fine texture inside the letters instead, which is the right thing for it to
 * degrade into.
 *
 * There is no text label. The mark says the word.
 *
 * It takes no props that change during a turn: the row it sits in re-renders on
 * every animation frame while a message streams, so anything driven from React
 * props here would fight the rAF loop rather than feed it. Everything about the
 * loop lives in `lib/ascii/engine`, including the single static frame under
 * `prefers-reduced-motion` — the reduced-motion block in globals.css collapses CSS
 * animation and cannot reach a canvas.
 */
export function ThinkingField() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // A fresh preset per mount: it carries per-row state between the engine's
    // `row` and `cell` calls, so two canvases must not share one.
    return mountAscii(canvas, flowPreset(config));
  }, []);

  return (
    <span role="status" aria-label="Thinking" className="thinking-mark">
      <canvas ref={ref} aria-hidden className="thinking-canvas" />
    </span>
  );
}
