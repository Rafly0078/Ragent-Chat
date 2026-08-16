import type { AsciiPreset, AsciiGrid } from './engine';

/**
 * The `ripple` preset: concentric wave crests travelling outward from one point,
 * shaded by glyph weight.
 *
 * Every value a radial ripple can express is read from the source file rather
 * than retyped, so reopening that file in the tool it came from and re-exporting
 * is the whole edit:
 *
 *   size    glyph size, as a multiple of the engine's BASE_FONT_PX
 *   scale2  ring frequency — how many crests fit across the field
 *   speed   how fast those crests travel outward
 *   zoom    scales the coordinate field the wave is measured in
 *   color   the one fill; `colorMode: 'solid'` means there is no second
 *
 * `rotation`, `logoMask` and `logoSize` carry no meaning here — a ripple is
 * rotationally symmetric, so rotating it is a no-op, and there is no logo to mask
 * against. They stay in the file so it round-trips through the tool intact.
 *
 * Because the colour mode is solid there is no per-cell colour to shade with:
 * brightness is carried entirely by glyph weight, a ' ' trough against a '@'
 * crest. That is what makes this ASCII rather than a monochrome plasma.
 */

/** What the preset needs out of an ascii-flow export. */
export interface RippleSource {
  size: { value: number };
  scale2: { value: number };
  speed: { value: number };
  zoom: { value: number };
  color: string;
}

/** Sparse to dense. Index 0 is a trough, and the engine skips it. */
const RAMP = ' .:-=+*#%@';

/** `speed: 1` times this is how fast the wave phase advances, in radians per
 *  second. At 2.2 a crest takes about 2.9s to travel one ring outward. */
const RAD_PER_SEC = 2.2;

/** Bends most cells down to ' ' so the field reads as texture, not wallpaper. */
const GAMMA = 1.9;

/** How far the wave carries from its origin, as a fraction of the half-diagonal
 *  it is measured in. Just under 1, so the far corner is silent and the field
 *  reads as something with a source rather than a texture tiled edge to edge. */
const REACH = 1.05;

/**
 * Where the wave starts, in fractions of the field.
 *
 * Off-centre deliberately: on the landing the headline sits on the left, so the
 * field's dense middle belongs to the right of it rather than underneath it.
 */
const ORIGIN_X = 0.66;
const ORIGIN_Y = 0.5;

/**
 * One preset instance drives one canvas. It carries per-row state between the
 * engine's `row` and `cell` calls, so sharing an instance across two mounts would
 * have them overwrite each other's rows.
 */
export function ripplePreset(source: RippleSource): AsciiPreset {
  const ringFrequency = source.scale2.value * Math.PI * 2;
  const brightest = RAMP.length - 1;

  // Hoisted out of the cell loop by `row` below. A row of 160 cells would
  // otherwise repeat the hypot, the two divisions and the vertical distance 160
  // times for one answer.
  let norm = 0;
  let originPxX = 0;
  let dySq = 0;

  return {
    colour: source.color,
    fontScale: source.size.value,
    rate: RAD_PER_SEC * source.speed.value,

    row(row: number, grid: AsciiGrid) {
      // Half the diagonal, not the short side. Normalising by the short side
      // makes a tall phone show the wave as a small disc adrift in the middle,
      // because the distance runs out vertically long before it reaches the top;
      // the diagonal keeps the same handful of rings on every aspect ratio.
      norm = 2 / (Math.hypot(grid.width, grid.height) * source.zoom.value);
      originPxX = grid.width * ORIGIN_X;
      const dy = ((row + 0.5) * grid.cellH - grid.height * ORIGIN_Y) * norm;
      dySq = dy * dy;
    },

    cell(col: number, _row: number, grid: AsciiGrid, phase: number) {
      const dx = ((col + 0.5) * grid.cellW - originPxX) * norm;
      const d = Math.sqrt(dx * dx + dySq);
      const wavePhase = d * ringFrequency - phase;
      // Two harmonics an octave apart. One alone reads as a machined target; the
      // beat between them is what makes it read as water.
      const wave = Math.sin(wavePhase) * 0.74 + Math.sin(wavePhase * 0.5 + 1.7) * 0.26;
      const lum = ((wave + 1) * 0.5) ** GAMMA * (1 - Math.min(1, d / REACH));
      return RAMP.charAt(Math.min(brightest, (lum * brightest + 0.5) | 0));
    },
  };
}
