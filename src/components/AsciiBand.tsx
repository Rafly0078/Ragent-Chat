'use client';

import { useEffect, useRef } from 'react';
import { mountAscii } from '@/lib/ascii/engine';
import { flowBandPreset } from '@/lib/ascii/flow';
import config from '@/features/chat/thinking-ascii.json';

/**
 * A patch of the flow field, for a surface that is waiting on something.
 *
 * This is the one rule the ASCII in this product follows: it appears while the
 * product is working. Three of them exist — the first session check, an artifact
 * preview loading its content, and a model list being fetched — and each replaces a
 * spinner that said the same thing with less character. Small, incidental waits
 * (attaching a file, saving a label) keep their spinner: this is for the moments
 * where the wait *is* the screen.
 *
 * Unmasked, unlike the THINKING wordmark: there the silhouette carries the meaning
 * and the field only fills it, so the two never read as the same element.
 *
 * It fills the box it is given, so the caller sizes it. Everything about the loop
 * lives in `lib/ascii/engine`, including the single static frame under
 * `prefers-reduced-motion`.
 */
export function AsciiBand({ label }: { label?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // A fresh preset per mount: it carries per-row state between the engine's
    // `row` and `cell` calls, so two canvases must not share one.
    return mountAscii(canvas, flowBandPreset(config));
  }, []);

  return (
    <span role="status" aria-label={label ?? 'Working'} className="ascii-band">
      <canvas ref={ref} aria-hidden className="ascii-band-canvas" />
      {label && <span className="ascii-band-label">{label}</span>}
    </span>
  );
}
