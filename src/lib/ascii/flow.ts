import type { AsciiPreset, AsciiGrid } from './engine';

/**
 * The `flow` preset: a vector field, drawn as streamlines.
 *
 * The ripple next door shades by glyph *weight* — a ramp from ' ' to '@'. This
 * one shades by glyph *direction*: each cell picks the one of `- \ | /` that
 * points along the field, so the grid reads as flow lines rather than as
 * brightness. That is the whole difference between the two modes, and it is why
 * they are separate files rather than one parameterised blur.
 *
 * Read from the source file:
 *
 *   size      glyph size, as a multiple of `baseFontPx`
 *   scale2    how many lattice cells of noise cross the field
 *   zoom      divides that, so the field reads as flow rather than as boiling
 *   speed     how fast the field drifts
 *   color     the one fill; `colorMode: 'solid'` means there is no second
 *
 * `logoMask: true` is honoured, but not here: the silhouette is the THINKING
 * wordmark, a raster, and a raster silhouette is a `mask-image` rather than a
 * `Path2D`. The browser scales and composites it for free at native resolution,
 * so `ThinkingField` applies it in CSS and this file only has to fill the box.
 *
 * `logoSize` and `rotation` carry no meaning at this call site — the canvas *is*
 * the wordmark's box, so there is nothing for a logo scale to scale inside, and a
 * field with no preferred axis reads the same rotated. Both stay in the file so it
 * round-trips through the tool that exported it.
 *
 * The noise is a value lattice rather than a sum of sines. At `scale2: 24` sines
 * beat against the cell grid and the result reads as a woven lattice — regular,
 * and obviously machine-made — where a hashed lattice reads as weather.
 */

/** What the preset needs out of an ascii-flow export. */
export interface FlowSource {
  size: { value: number };
  scale2: { value: number };
  speed: { value: number };
  zoom: { value: number };
  color: string;
}

/** 0°, 45°, 90°, 135°. A line has half-turn symmetry, so four cover every angle. */
const DIRS = '-\\|/';

/** The fringe glyph, for cells only just inside the field. */
const FAINT = '.';

/** `scale2 / this / zoom` is how many lattice cells of noise cross the wordmark.
 *  At 24 / 2 / 1.3 that is 9.2 — one cell of the field spans about fifteen columns
 *  of a 137-column word, so the direction turns two or three times per letter
 *  group and a whole run of glyphs agrees about where it is going. Finer than this
 *  and a three-cell letter stroke holds three unrelated directions; coarser and the
 *  entire word points one way at a time. */
const TURNS_DIVISOR = 2;

/** `speed: 3.55` times this is field units per second — about 0.9, so the pattern
 *  crosses the mark in roughly two and a half seconds. */
const UNITS_PER_SEC = 0.26;

/** Two frequencies, sampled off the same lattice. The angle field is the coarser
 *  of the two — a streamline only reads as a line if several cells in a row agree
 *  about the direction — and the gate is the finer, so its voids arrive as stipple
 *  rather than as bites out of a letter. Both are fractions of `turns`. */
const ANGLE_SCALE = 0.6;
const GATE_SCALE = 1.5;

/** The wordmark is 12:1, and isotropic noise on a box that shape has almost nothing
 *  to say about the short axis: seven rows would span a fifth of one lattice cell
 *  and every column would read the same top to bottom. Stretching the vertical
 *  sample gives the letters real variation through their height, and it leans the
 *  streaks horizontal — which is the direction a word runs anyway. */
const CROSS_STRETCH = 4;

/** Below this the cell is blank. The silhouette is what shapes this preset now, so
 *  the gate is only here to keep the fill alive: at a three-cell stroke width a
 *  void reads as a chip out of the letter, not as flow. Sparse stipple, no more. */
const GATE = 0.02;
const FRINGE = 0.06;

/** What `size: 0.6` multiplies at the wordmark's full column width: 9px glyphs on a
 *  5.4px column step, about 137 columns across the word. A preset file's `size` is
 *  relative to whatever the tool that exported it used, so the absolute scale is
 *  this renderer's to pick. */
const BASE_FONT_PX = 15;

/** A letter stroke, as a fraction of the wordmark's width — measured off the asset:
 *  a 40px stem in an 1826px word. */
const STROKE_FRACTION = 40 / 1826;

/** How many glyph cells have to span a stroke. Below three, a run of glyphs cannot
 *  state a direction and the letters dissolve into scattered hatching; the word
 *  stops being a word. This is what makes the glyph size follow the box rather than
 *  sit at one value and let a phone break it. */
const CELLS_PER_STROKE = 3;

/** The mono advance, as a fraction of the glyph size. JetBrains Mono is 0.6em, and
 *  the engine measures the real value — this is only for choosing the size. */
const ADVANCE_RATIO = 0.6;

/** Glyphs this small do not survive a 1x display: at 9px the hinting turns every
 *  stroke into a blob. Rendering the backing store at 2x whatever the screen says
 *  and letting the browser downscale is what keeps them as strokes. */
const MIN_DPR = 2;

/** Row pitch, overriding the engine's default. Slightly squarer than the 1.04 a
 *  density ramp wants: this preset shades by direction, and the taller the cell
 *  the more a '\' reads as a steep tick with gaps above and below it. Squarer than
 *  this and consecutive rows of '|' merge into solid hatching — the flow stops
 *  reading as lines and starts reading as fur. */
const LINE_RATIO = 0.62;

/** A hashed value lattice in [0, 1). */
function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function noise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  // Smoothstep on the lattice fraction. Linear interpolation alone leaves visible
  // creases along every integer line, and at this frequency they land on the cell
  // grid and read as a plaid.
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** One instance drives one canvas — it carries per-row state between the engine's
 *  `row` and `cell` calls. */
export function flowPreset(source: FlowSource): AsciiPreset {
  const turns = source.scale2.value / TURNS_DIVISOR / source.zoom.value;

  // Hoisted by `row`: both are constant across a row, and `vy` costs a divide.
  let scale = 0;
  let vy = 0;

  return {
    colour: source.color,
    fontScale: source.size.value,
    baseFontPx: BASE_FONT_PX,
    lineRatio: LINE_RATIO,
    minDpr: MIN_DPR,
    rate: UNITS_PER_SEC * source.speed.value,

    /** Three cells across a letter stroke, whatever width the column gave us. At
     *  the full 740px that lands on the 9px `size` implies; on a 390px phone it
     *  drops to 5px, which supersampling keeps sharp. */
    fontPxFor(width: number) {
      return Math.min(
        BASE_FONT_PX * source.size.value,
        (width * STROKE_FRACTION) / (CELLS_PER_STROKE * ADVANCE_RATIO),
      );
    },

    row(row: number, grid: AsciiGrid) {
      // Both axes normalise by the same length, so the field is isotropic: a
      // swirl is round rather than stretched by the cell's tall aspect.
      scale = turns / Math.max(1, grid.width);
      vy = (row + 0.5) * grid.cellH * scale * CROSS_STRETCH;
    },

    cell(col: number, _row: number, grid: AsciiGrid, phase: number) {
      const u = (col + 0.5) * grid.cellW * scale;
      // The gate is a second field, higher-frequency than the angle and drifting
      // across it rather than with it. Sharing one field would move the voids
      // along the streamlines and the whole word would read as a single sliding
      // texture; running the gate slower left holes that sat still long enough to
      // look like gaps in the letters rather than like flow.
      const gate = noise(u * GATE_SCALE - phase * 0.6, vy * GATE_SCALE + phase * 0.42);
      if (gate < GATE) return '';
      if (gate < GATE + FRINGE) return FAINT;

      // A scalar field mapped to angle, drifting upward. Sampled at a lower
      // frequency than the gate on purpose: the angle is what has to stay
      // coherent from cell to cell for a run of glyphs to read as one line, while
      // the gate wants to be fine-grained so the voids are stipple rather than
      // holes. One turn of range for the same reason — two made neighbours
      // disagree often enough that the lines broke up into tally marks.
      const angle = noise(u * ANGLE_SCALE + phase * 0.3, vy * ANGLE_SCALE - phase) * Math.PI * 2;
      let a = angle % Math.PI;
      if (a < 0) a += Math.PI;
      return DIRS.charAt(Math.round((a / Math.PI) * DIRS.length) % DIRS.length);
    },
  };
}
