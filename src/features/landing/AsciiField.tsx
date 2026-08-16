'use client';

import { useEffect, useRef } from 'react';
import { mountAscii } from '@/lib/ascii/engine';
import { ripplePreset } from '@/lib/ascii/ripple';
import config from './ascii-flow.json';

/**
 * The ASCII field behind the landing page: the `ripple` preset in
 * `ascii-flow.json`, drawn as text on a canvas.
 *
 * The maths lives in `lib/ascii/ripple`, the canvas machinery in
 * `lib/ascii/engine`, and this file is the mount point plus the two layers that
 * keep the wave off the words — see `.ascii-canvas` and `.ascii-scrim`.
 */
export function AsciiField() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // A fresh preset per mount: it carries per-row state, so two canvases must
    // not share one. StrictMode's double mount gets its own for the same reason.
    return mountAscii(canvas, ripplePreset(config));
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-surface">
      <canvas ref={ref} className="ascii-canvas absolute inset-0 h-full w-full" />
      <div className="ascii-scrim absolute inset-0" />
    </div>
  );
}
