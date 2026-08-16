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
 *   size      glyph size, as a multiple of the engine's BASE_FONT_PX
 *   scale2    how many turns of the field fit across the mark
 *   zoom      divides that, so the field reads as flow rather than as boiling
 *   speed     how fast the field drifts through the mark
 *   logoMask  true here: the glyph pass is clipped to the mark's silhouette
 *   logoSize  scales that silhouette
 *   color     the one fill; `colorMode: 'solid'` means there is no second
 *
 * `rotation` is 0 and is a no-op for a field with no preferred axis, exactly as
 * on the landing. It stays in the file so it round-trips through the tool.
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
  logoSize: { value: number };
  logoMask: boolean;
  color: string;
}

/** 0°, 45°, 90°, 135°. A line has half-turn symmetry, so four cover every angle. */
const DIRS = '-\\|/';

/** The fringe glyph, for cells only just inside the field. */
const FAINT = '.';

/** `scale2 / this / zoom` is how many lattice cells of noise cross the mark. At
 *  24 / 4 / 1.3 that is 4.6, so one cell of the field spans about six columns of
 *  a 27-column patch — coherent enough to read as a line, fine enough to curve
 *  several times across the mark. Divide by much more and the whole patch is one
 *  smooth ramp with the flow bunched into a single corner. */
const TURNS_DIVISOR = 4;

/** `speed: 3.55` times this is field units per second — about 0.9, so the pattern
 *  crosses the mark in roughly two and a half seconds. */
const UNITS_PER_SEC = 0.26;

/** Two frequencies, sampled off the same lattice. The angle field is the coarser
 *  of the two — a streamline only reads as a line if several cells in a row agree
 *  about the direction — and the gate is the finer, so its voids arrive as stipple
 *  rather than as holes in the mark. Both are fractions of `turns`. */
const ANGLE_SCALE = 0.6;
const GATE_SCALE = 1.5;

/** Below this the cell is blank, which is what gives the flow voids instead of a
 *  filled square; the next slice above it gets the fringe glyph. */
const GATE = 0.46;
const FRINGE = 0.06;

/** The mark's side, as a fraction of the box's short side, before `logoSize`. */
const MARK_FRACTION = 0.62;

/** Corner radius and lamp radius, as fractions of the mark's side. The corner is
 *  the BrandMark SVG's own proportion (4/21 of its square) so the clipped field and
 *  the static mark elsewhere read as the same figure. The lamp is deliberately
 *  smaller than the SVG's: at the mark's real proportion it lands as a headlight
 *  in the middle of the texture rather than as a point of light inside it. */
const CORNER = 4 / 21;
const LAMP = 0.05;

/** What `size: 0.6` multiplies, giving 9px glyphs and a 5.4px column step: about
 *  19 columns across a 104px mark. The engine's own 12px base would land at 7px,
 *  which packs 25 columns into the same square and reads as a QR code rather than
 *  as flow — a preset file's `size` is relative to the tool that exported it, so
 *  the absolute scale is this renderer's to pick. */
const BASE_FONT_PX = 15;

/** Glyphs this small do not survive a 1x display: at 9px the hinting turns every
 *  stroke into a blob. Rendering the backing store at 2x whatever the screen says
 *  and letting the browser downscale is what keeps them as strokes. */
const MIN_DPR = 2;

/** Row pitch, overriding the engine's default. Slightly squarer than the 1.04 a
 *  density ramp wants: this preset shades by direction, and the taller the cell
 *  the more a '\' reads as a steep tick with gaps above and below it. Squarer than
 *  this and consecutive rows of '|' merge into solid hatching — the flow stops
 *  reading as lines and starts reading as fur. */
const LINE_RATIO = 0.95;

/** How much of the boundary the overlay draws. Faint: the stroke is there to keep
 *  the room's edge legible where the flow happens to be sparse, not to frame it. */
const EDGE_ALPHA = 0.28;

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

/** The mark's square, in CSS pixels, centred in the grid's box. */
function markBox(grid: AsciiGrid, logoSize: number) {
  const side = Math.min(grid.width, grid.height) * MARK_FRACTION * logoSize;
  return {
    side,
    x: (grid.width - side) / 2,
    y: (grid.height - side) / 2,
  };
}

/**
 * `arcTo`, not `Path2D.roundRect`. Firefox only shipped roundRect in 112 and this
 * project's floor is 111, where it would throw and take the whole canvas with it.
 */
function roundedSquare(x: number, y: number, side: number, r: number): Path2D {
  const path = new Path2D();
  path.moveTo(x + r, y);
  path.arcTo(x + side, y, x + side, y + side, r);
  path.arcTo(x + side, y + side, x, y + side, r);
  path.arcTo(x, y + side, x, y, r);
  path.arcTo(x, y, x + side, y, r);
  path.closePath();
  return path;
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

    row(row: number, grid: AsciiGrid) {
      // Both axes normalise by the same length, so the field is isotropic: a
      // swirl is round rather than stretched by the cell's tall aspect.
      scale = turns / Math.max(1, grid.width);
      vy = (row + 0.5) * grid.cellH * scale;
    },

    cell(col: number, _row: number, grid: AsciiGrid, phase: number) {
      const u = (col + 0.5) * grid.cellW * scale;
      // The gate is a second field, higher-frequency than the angle and drifting
      // across it rather than with it. Sharing one field would move the voids
      // along the streamlines and the whole patch would read as a single sliding
      // texture; running the gate slower left holes that sat still long enough to
      // look like gaps in the mark rather than like flow.
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

    clip(grid: AsciiGrid) {
      if (!source.logoMask) return undefined;
      const { x, y, side } = markBox(grid, source.logoSize.value);
      return roundedSquare(x, y, side, side * CORNER);
    },

    overlay(ctx: CanvasRenderingContext2D, grid: AsciiGrid) {
      if (!source.logoMask) return;
      const { x, y, side } = markBox(grid, source.logoSize.value);
      ctx.save();
      ctx.globalAlpha = EDGE_ALPHA;
      ctx.lineWidth = 1;
      // Half-pixel inset so a 1px stroke lands on the pixel rather than across it.
      ctx.stroke(roundedSquare(x + 0.5, y + 0.5, side - 1, side * CORNER));
      ctx.restore();
      // The lamp: the one fixed point in a moving field, and what makes the patch
      // read as the product's mark rather than as a square of weather.
      ctx.beginPath();
      ctx.arc(x + side / 2, y + side / 2, side * LAMP, 0, Math.PI * 2);
      ctx.fill();
    },
  };
}
