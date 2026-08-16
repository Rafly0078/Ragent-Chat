'use client';

import { useEffect, useRef } from 'react';
import { mountAscii } from '@/lib/ascii/engine';
import { flowPreset, type MarkGeometry } from '@/lib/ascii/flow';
import config from '@/features/chat/thinking-ascii.json';
import { cn } from '@/lib/utils/cn';

/**
 * A wordmark filled with the flowing ASCII field: the product saying, in its own
 * letters, what it is doing.
 *
 * `logoMask: true` in the preset file means the glyph pass is clipped to a
 * silhouette, and the silhouette is a raster — so it is a `mask-image` rather than a
 * `Path2D`. The browser scales and composites it at native resolution for nothing,
 * the canvas only has to fill its box, and the letter edges stay crisp while glyphs
 * are cut mid-stroke, which is what makes it read as a word rather than as a stencil.
 *
 * Two marks so far, and the geometry below is what the field needs to know about
 * each: the aspect ratio decides how thick a letter stroke is at a given width, and
 * the glyph size is chosen from that so a stroke always holds the same few cells. A
 * third mark is its asset, three numbers, and a class.
 *
 * It takes no props that change during a turn: the row it sits in re-renders on
 * every animation frame while a message streams, so anything driven from React props
 * here would fight the rAF loop rather than feed it. Everything about the loop lives
 * in `lib/ascii/engine`, including the single static frame under
 * `prefers-reduced-motion` — the reduced-motion block in globals.css collapses CSS
 * animation and cannot reach a canvas.
 */
const MARKS: Record<string, MarkGeometry> = {
  // 1536x127. Eight letters, so the strokes are relatively thick and 3.5 cells fit.
  thinking: { aspect: 1536 / 127, cells: 3.5, dpr: 3 },
  // 1536x93. Ten letters over the same width, so the cap height is shorter and the
  // strokes thinner — fewer cells fit, and they need a deeper supersample to survive.
  generating: { aspect: 1536 / 93, cells: 3, dpr: 4 },
};

export function AsciiWordmark({
  variant,
  label,
}: {
  variant: 'thinking' | 'generating';
  /** What the mark means, for anything that cannot see it. */
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // A fresh preset per mount: it carries per-row state between the engine's
    // `row` and `cell` calls, so two canvases must not share one.
    return mountAscii(canvas, flowPreset(config, MARKS[variant]!));
  }, [variant]);

  return (
    <span role="status" aria-label={label} className={cn('ascii-wordmark', `is-${variant}`)}>
      <canvas ref={ref} aria-hidden className="ascii-wordmark-canvas" />
    </span>
  );
}
