'use client';

import { useEffect, useRef } from 'react';
import config from './ascii-flow.json';

/**
 * The ASCII field behind the landing page: the `ripple` preset in
 * `ascii-flow.json`, drawn as text on a canvas.
 *
 * The preset file is the source of truth for the look, so every value in it that
 * a radial ripple can express is read from it rather than retyped here:
 *
 *   size    1.65     glyph size, as a multiple of BASE_FONT_PX
 *   scale2  7        ring frequency — how many crests fit across the field
 *   speed   1        how fast those crests travel outward
 *   zoom    1        scales the coordinate field the wave is measured in
 *   color   #FFFFFF  the one fill; `colorMode: 'solid'` means there is no second
 *
 * `rotation`, `logoMask` and `logoSize` carry no meaning for this preset — a
 * ripple is rotationally symmetric, so rotating it is a no-op, and there is no
 * logo to mask against. They stay in the file so it can be reopened and
 * re-exported in the tool it came from without losing state.
 *
 * Because `colorMode` is `solid` there is no per-cell colour to shade with:
 * brightness is carried entirely by glyph weight, a ' ' trough against a '@'
 * crest. That is what makes this ASCII rather than a monochrome plasma, and it
 * is why the entire frame draws at one `fillStyle`.
 */

/** Sparse to dense. Index 0 is a trough and is never drawn. */
const RAMP = ' .:-=+*#%@';

/** `size: 1.65` times this is the glyph size in CSS pixels. */
const BASE_FONT_PX = 12;

/** Cell height as a multiple of the glyph size. Rings stay circular whatever
 *  this is: the wave is measured in pixels, not in cells. */
const LINE_RATIO = 1.04;

/** `speed: 1` times this is how fast the wave phase advances, in radians per
 *  second. At 2.2 a crest takes about 2.9s to travel one ring outward. */
const RAD_PER_SEC = 2.2;

/** Bends most cells down to ' ' so the field reads as texture, not wallpaper. */
const GAMMA = 1.9;

/** How far the wave carries from its origin, as a fraction of the half-diagonal
 *  it is measured in. Just under 1, so the far corner is silent and the field
 *  reads as something with a source rather than a texture tiled edge to edge. */
const REACH = 1.05;

/** Off-centre deliberately. The headline sits on the left, so the field's dense
 *  middle belongs to the right of it rather than underneath it. */
const ORIGIN_X = 0.66;
const ORIGIN_Y = 0.5;

/** 30fps. A glyph grid quantises motion far harder than the frame rate does, so
 *  the second half of a 60fps budget buys nothing visible here. */
const FRAME_MS = 1000 / 30;

/** Glyphs this size cost fill area quadratically in device pixel ratio, and a
 *  background this faint has no detail worth resolving past 2x. */
const MAX_DPR = 2;

export function AsciiField() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const fontPx = Math.max(6, Math.round(BASE_FONT_PX * config.size.value));
    const ringFrequency = config.scale2.value * Math.PI * 2;
    const phaseRate = RAD_PER_SEC * config.speed.value;
    const brightest = RAMP.length - 1;

    // One static frame instead of a loop. The reduced-motion block in
    // globals.css can only reach CSS animation; a canvas has to opt in itself.
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // next/font hands out a hashed family name and only ever exposes it through
    // the CSS variable, so a literal 'JetBrains Mono' here would silently miss
    // and lay the grid out on the platform fallback's advance width instead.
    const family =
      getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() ||
      'ui-monospace, monospace';

    let w = 0;
    let h = 0;
    let cols = 0;
    let rows = 0;
    let cellW = 0;
    let cellH = 0;
    let raf = 0;
    let lastFrame = 0;
    let originAt = 0;
    let hiddenAt = 0;
    let disposed = false;

    // Arrow consts rather than declarations: a hoisted `function` can in
    // principle run before the two null checks above, so TypeScript drops their
    // narrowing inside one and every `canvas`/`ctx` use needs an assertion.
    const measure = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      // Sizing the backing store resets every context property, so the font,
      // the baseline and the fill belong here rather than once at startup.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${fontPx}px ${family}`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = config.color;
      // The column step is the font's own advance width. That is what lets a
      // whole run of glyphs land cell-perfect from a single fillText below.
      cellW = ctx.measureText('M').width || fontPx * 0.6;
      cellH = fontPx * LINE_RATIO;
      cols = Math.ceil(w / cellW);
      rows = Math.ceil(h / cellH);
    };

    const draw = (seconds: number) => {
      const t = seconds * phaseRate;
      const originPxX = w * ORIGIN_X;
      const originPxY = h * ORIGIN_Y;
      // Half the diagonal, not the short side. Normalising by the short side
      // makes a tall phone show the wave as a small disc adrift in the middle,
      // because `d` runs out vertically long before it reaches the top; the
      // diagonal keeps the same handful of rings on every aspect ratio.
      const norm = 2 / (Math.hypot(w, h) * config.zoom.value);
      ctx.clearRect(0, 0, w, h);

      for (let r = 0; r < rows; r++) {
        const y = (r + 0.5) * cellH;
        const dy = (y - originPxY) * norm;
        const dySq = dy * dy;
        // Contiguous non-blank cells go out as one string. A 160-cell row costs
        // a handful of fillText calls instead of 160, which is the whole reason
        // a text grid this size holds 30fps on a phone.
        let run = '';
        let runAt = 0;

        for (let c = 0; c < cols; c++) {
          const dx = ((c + 0.5) * cellW - originPxX) * norm;
          const d = Math.sqrt(dx * dx + dySq);
          const phase = d * ringFrequency - t;
          // Two harmonics an octave apart. One alone reads as a machined
          // target; the beat between them is what makes it read as water.
          const wave = Math.sin(phase) * 0.74 + Math.sin(phase * 0.5 + 1.7) * 0.26;
          const lum = ((wave + 1) * 0.5) ** GAMMA * (1 - Math.min(1, d / REACH));
          const level = Math.min(brightest, (lum * brightest + 0.5) | 0);

          if (level <= 0) {
            if (run) {
              ctx.fillText(run, runAt * cellW, y);
              run = '';
            }
          } else {
            if (!run) runAt = c;
            run += RAMP.charAt(level);
          }
        }
        if (run) ctx.fillText(run, runAt * cellW, y);
      }
    };

    const frame = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      if (now - lastFrame < FRAME_MS) return;
      lastFrame = now;
      draw((now - originAt) / 1000);
    };

    const start = () => {
      lastFrame = 0;
      raf = requestAnimationFrame(frame);
    };

    const relayout = () => {
      measure();
      if (still) draw(0);
    };

    const onVisibility = () => {
      if (still) return;
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        hiddenAt = performance.now();
      } else if (!raf) {
        // Discard the phase the wave would have travelled while nobody was
        // watching, so coming back to the tab is not a jump cut.
        originAt += performance.now() - hiddenAt;
        start();
      }
    };

    const observer = new ResizeObserver(relayout);

    measure();
    if (still) {
      draw(0);
    } else {
      originAt = performance.now();
      start();
    }
    observer.observe(canvas);
    document.addEventListener('visibilitychange', onVisibility);

    // A canvas never starts a font load of its own; the page's own mono text
    // does. Until that face lands the grid sits on fallback metrics, so measure
    // once more when it arrives and redraw on the real advance width.
    void document.fonts.ready.then(() => {
      if (!disposed) relayout();
    });

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-surface">
      <canvas ref={ref} className="ascii-canvas absolute inset-0 h-full w-full" />
      <div className="ascii-scrim absolute inset-0" />
    </div>
  );
}
