/**
 * The machinery behind every ASCII field in the product.
 *
 * Both call sites — the landing's ripple and the chat's thinking flow — need the
 * same dozen things: a device-pixel-capped backing store, a grid laid out on the
 * mono font's own advance width, contiguous glyphs batched into one `fillText`, a
 * frame cap, a single static frame under `prefers-reduced-motion`, a pause while
 * the tab is hidden that does not jump the phase on return, a re-measure when the
 * font finally lands, and a teardown that survives StrictMode's double mount.
 *
 * All of that lives here. A preset supplies only the maths: what character, if
 * any, belongs in a cell at a moment in time.
 *
 * The two presets are different enough in kind that this seam is worth it — one
 * is a radial density ramp, the other a directional vector field with a clip —
 * and they still agree on every line of the machinery.
 */

/** The grid a preset is sampled on. Rebuilt on every resize. Sizes are CSS px. */
export interface AsciiGrid {
  width: number;
  height: number;
  cols: number;
  rows: number;
  /** The font's own advance width, which is also the column step. */
  cellW: number;
  cellH: number;
}

export interface AsciiPreset {
  /** The preset file's `color`. One fill for the whole frame — see `colorMode`. */
  colour: string;
  /** The preset file's `size`, as a multiple of `baseFontPx`. */
  fontScale: number;
  /** What `fontScale` multiplies. Defaults to BASE_FONT_PX.
   *  A preset file's `size` is relative to whatever base the tool it came from
   *  used, so the absolute scale is this renderer's to choose — and the choice is
   *  per preset: `size: 1.65` and `size: 0.6` are three octaves apart. */
  baseFontPx?: number;
  /** Row pitch as a multiple of the glyph size. Defaults to LINE_RATIO.
   *  A preset that shades by glyph *direction* wants squarer cells than one that
   *  shades by weight, or its diagonals read as tally marks rather than as lines. */
  lineRatio?: number;
  /** A floor on the backing store's scale, for a preset whose glyphs are small
   *  enough that a 1x display cannot resolve them. Supersampling and letting the
   *  browser downscale is what keeps them from turning into blobs. */
  minDpr?: number;
  /** Phase advance in units per second, already multiplied by the file's `speed`. */
  rate: number;
  /** Per-row hoist, so a preset can compute a row's constants once. Optional. */
  row?(row: number, grid: AsciiGrid, phase: number): void;
  /** The glyph for one cell. '' or ' ' leaves it blank. */
  cell(col: number, row: number, grid: AsciiGrid, phase: number): string;
  /** Clips the glyph pass, for a preset whose file sets `logoMask: true`. Returns
   *  undefined when that flag is off, which is how the flag is honoured. */
  clip?(grid: AsciiGrid): Path2D | undefined;
  /** Drawn after the glyphs and outside the clip, so it can stroke the boundary. */
  overlay?(ctx: CanvasRenderingContext2D, grid: AsciiGrid, phase: number): void;
}

/** What `fontScale` multiplies when a preset does not name its own base. */
const BASE_FONT_PX = 12;

/** Row pitch as a multiple of the glyph size, when a preset does not set its own. */
const LINE_RATIO = 1.04;

/** 30fps. A glyph grid quantises motion far harder than the frame rate does, so
 *  the second half of a 60fps budget buys nothing visible. */
const FRAME_MS = 1000 / 30;

/** Glyphs cost fill area quadratically in device pixel ratio, and a field this
 *  faint has no detail worth resolving past 2x. */
const MAX_DPR = 2;

/**
 * Start a preset on a canvas. Returns the teardown.
 *
 * The canvas is expected to be sized by CSS; this reads that size back and keeps
 * the backing store in step with it.
 */
export function mountAscii(canvas: HTMLCanvasElement, preset: AsciiPreset): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const fontPx = Math.max(6, Math.round((preset.baseFontPx ?? BASE_FONT_PX) * preset.fontScale));

  // One static frame instead of a loop. The reduced-motion block in globals.css
  // can only reach CSS animation; a canvas has to opt in itself.
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // next/font hands out a hashed family name and only ever exposes it through the
  // CSS variable, so a literal 'JetBrains Mono' here would silently miss and lay
  // the grid out on the platform fallback's advance width instead.
  const family =
    getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() ||
    'ui-monospace, monospace';

  const grid: AsciiGrid = { width: 0, height: 0, cols: 0, rows: 0, cellW: 0, cellH: 0 };

  let clipPath: Path2D | undefined;
  let raf = 0;
  let lastFrame = 0;
  let originAt = 0;
  let hiddenAt = 0;
  let disposed = false;

  const measure = () => {
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, preset.minDpr ?? 1), MAX_DPR);
    const rect = canvas.getBoundingClientRect();
    grid.width = Math.max(1, Math.round(rect.width));
    grid.height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(grid.width * dpr);
    canvas.height = Math.round(grid.height * dpr);
    // Sizing the backing store resets every context property, so the transform,
    // the font, the baseline and the fill belong here rather than once at startup.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${fontPx}px ${family}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = preset.colour;
    ctx.strokeStyle = preset.colour;
    // The column step is the font's own advance width. That is what lets a whole
    // run of glyphs land cell-perfect from a single fillText below.
    grid.cellW = ctx.measureText('M').width || fontPx * 0.6;
    grid.cellH = fontPx * (preset.lineRatio ?? LINE_RATIO);
    grid.cols = Math.ceil(grid.width / grid.cellW);
    grid.rows = Math.ceil(grid.height / grid.cellH);
    // Built once per layout rather than once per frame: the path only depends on
    // the grid, and a Path2D allocation 30 times a second is pure garbage.
    clipPath = preset.clip?.(grid);
  };

  const draw = (seconds: number) => {
    const phase = seconds * preset.rate;
    ctx.clearRect(0, 0, grid.width, grid.height);

    if (clipPath) {
      ctx.save();
      ctx.clip(clipPath);
    }

    for (let r = 0; r < grid.rows; r++) {
      preset.row?.(r, grid, phase);
      const y = (r + 0.5) * grid.cellH;
      // Contiguous non-blank cells go out as one string. A 160-cell row costs a
      // handful of fillText calls instead of 160, which is the whole reason a text
      // grid this size holds 30fps on a phone.
      let run = '';
      let runAt = 0;

      for (let c = 0; c < grid.cols; c++) {
        const glyph = preset.cell(c, r, grid, phase);
        if (glyph === '' || glyph === ' ') {
          if (run) {
            ctx.fillText(run, runAt * grid.cellW, y);
            run = '';
          }
        } else {
          if (!run) runAt = c;
          run += glyph;
        }
      }
      if (run) ctx.fillText(run, runAt * grid.cellW, y);
    }

    if (clipPath) ctx.restore();
    preset.overlay?.(ctx, grid, phase);
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
      // Discard the phase the field would have travelled while nobody was
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

  // A canvas never starts a font load of its own; the page's own mono text does.
  // Until that face lands the grid sits on fallback metrics, so measure once more
  // when it arrives and redraw on the real advance width.
  void document.fonts.ready.then(() => {
    if (!disposed) relayout();
  });

  return () => {
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    observer.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
