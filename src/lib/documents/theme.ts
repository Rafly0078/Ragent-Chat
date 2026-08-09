/**
 * Document theming.
 *
 * The model picks the palette (see `src/lib/tools/prompt.ts`): it sends
 * `accent:`, and optionally `ink:` / `font:`, and this module expands that into
 * every colour the three renderers need. The model is deliberately NOT trusted
 * to pick a readable combination — `accent: #FFE24D` on white paper is a real
 * thing a weak model emits — so every derived colour is contrast-clamped here,
 * once, rather than in each renderer.
 *
 * Hex strings are stored WITHOUT the leading `#`, because that is the form
 * `docx` and `pptxgenjs` require; the HTML/PDF renderer adds it back.
 */

// Type-only, so this module stays free of the `server-only` marker that
// `markdown.ts` carries and can be imported from anywhere.
import type { CalloutVariant } from './markdown';

export interface ThemeInput {
  accent?: string;
  ink?: string;
  font?: string;
  cover?: boolean;
  subtitle?: string;
  author?: string;
}

export interface DocTheme {
  /** Brand colour, as sent (clamped only if it fails contrast on white). */
  accent: string;
  /** Darker accent for headings and links — guaranteed readable on paper. */
  accentDark: string;
  /** Very light accent tint, for callout and table-header fills. */
  accentSoft: string;
  /** Readable text colour on top of a solid `accent` fill. */
  accentFg: string;
  ink: string;
  muted: string;
  border: string;
  codeFill: string;
  codeInk: string;
  highlightFill: string;
  /** CSS font stacks (HTML/PDF). */
  bodyFont: string;
  headingFont: string;
  monoFont: string;
  /** Single family names — Office formats take one name, not a stack. */
  officeBody: string;
  officeHeading: string;
  officeMono: string;
  /**
   * Whether to emit a cover page. `undefined` means the model didn't say, and
   * the renderer decides from document length — a cover on a one-page memo is
   * just a wasted sheet.
   */
  cover?: boolean;
  subtitle?: string;
  author?: string;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Colour words models reach for when they don't write hex. */
const NAMED: Record<string, string> = {
  blue: '2563EB',
  indigo: '4F46E5',
  violet: '7C3AED',
  purple: '9333EA',
  magenta: 'C026D3',
  pink: 'DB2777',
  rose: 'E11D48',
  red: 'DC2626',
  orange: 'EA580C',
  amber: 'D97706',
  yellow: 'CA8A04',
  gold: 'B45309',
  lime: '65A30D',
  green: '16A34A',
  emerald: '059669',
  teal: '0D9488',
  cyan: '0891B2',
  sky: '0284C7',
  navy: '1E3A8A',
  slate: '475569',
  gray: '4B5563',
  grey: '4B5563',
  zinc: '52525B',
  stone: '57534E',
  brown: '78350F',
  maroon: '7F1D1D',
  black: '111111',
};

const DEFAULT_ACCENT = '2563EB';
const DEFAULT_INK = '1A1A16';

/** Parse `#0b5fff`, `0B5FFF`, `#abc` or a colour word into RGB, or null. */
function parseColor(raw: string | undefined): RGB | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase().replace(/^#/, '');
  if (NAMED[s]) s = NAMED[s]!.toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) s = s.replace(/./g, (c) => c + c);
  if (!/^[0-9a-f]{6}$/.test(s)) return null;
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

function toHex({ r, g, b }: RGB): string {
  return [r, g, b]
    .map((n) => clamp255(n).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/** WCAG relative luminance. */
function luminance({ r, g, b }: RGB): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const WHITE: RGB = { r: 255, g: 255, b: 255 };

/** Blend `c` toward `target` by `amount` (0 = unchanged, 1 = target). */
function mix(c: RGB, target: RGB, amount: number): RGB {
  return {
    r: c.r + (target.r - c.r) * amount,
    g: c.g + (target.g - c.g) * amount,
    b: c.b + (target.b - c.b) * amount,
  };
}

const BLACK: RGB = { r: 0, g: 0, b: 0 };

/**
 * Darken `c` until it reaches `ratio` against white paper.
 *
 * Stepwise toward black rather than an HSL lightness cut, so a hue that is
 * already dark enough is left exactly as the model sent it. Bounded loop: a
 * colour that cannot reach the ratio ends up black, which is at least readable.
 */
function darkenFor(c: RGB, ratio: number): RGB {
  let out = c;
  for (let i = 0; i < 20 && contrast(out, WHITE) < ratio; i++) {
    out = mix(out, BLACK, 0.08);
  }
  return out;
}

/** White or near-black, whichever is legible on `bg`. */
function readableOn(bg: RGB): RGB {
  const ink = { r: 26, g: 26, b: 22 };
  return contrast(WHITE, bg) >= contrast(ink, bg) ? WHITE : ink;
}

/**
 * Font families. The model sends a coarse hint (`sans`, `serif`, `mono`) or a
 * family name; anything unrecognized falls back to sans rather than trusting an
 * arbitrary string into a `font-family` — a name the renderer doesn't have
 * silently degrades to a random default, which looks worse than the default we
 * chose on purpose.
 */
const FONT_SETS = {
  sans: {
    body: "'Inter', 'Helvetica Neue', Helvetica, Arial, 'Noto Sans', sans-serif",
    heading: "'Inter', 'Helvetica Neue', Helvetica, Arial, 'Noto Sans', sans-serif",
    officeBody: 'Calibri',
    officeHeading: 'Calibri Light',
  },
  serif: {
    body: "'Source Serif 4', Georgia, 'Times New Roman', 'Noto Serif', serif",
    heading: "'Source Serif 4', Georgia, 'Times New Roman', 'Noto Serif', serif",
    officeBody: 'Georgia',
    officeHeading: 'Georgia',
  },
  mono: {
    body: "'JetBrains Mono', 'SF Mono', Consolas, 'Liberation Mono', monospace",
    heading: "'JetBrains Mono', 'SF Mono', Consolas, 'Liberation Mono', monospace",
    officeBody: 'Consolas',
    officeHeading: 'Consolas',
  },
  /** Serif headings over a sans body — the classic report/whitepaper pairing. */
  editorial: {
    body: "'Inter', Helvetica, Arial, 'Noto Sans', sans-serif",
    heading: "'Source Serif 4', Georgia, 'Times New Roman', serif",
    officeBody: 'Calibri',
    officeHeading: 'Georgia',
  },
} as const;

const MONO_STACK = "'JetBrains Mono', 'SF Mono', Consolas, 'Liberation Mono', monospace";

function fontSet(raw: string | undefined) {
  const key = (raw ?? '').trim().toLowerCase();
  if (key in FONT_SETS) return FONT_SETS[key as keyof typeof FONT_SETS];
  if (/serif/.test(key) && /sans/.test(key)) return FONT_SETS.editorial;
  if (/georgia|times|garamond|book|serif/.test(key)) return FONT_SETS.serif;
  if (/mono|code|consol|courier/.test(key)) return FONT_SETS.mono;
  return FONT_SETS.sans;
}

/**
 * Expand the model's theme hints into a full, readable palette.
 *
 * Never throws and never rejects: an unparseable colour falls back to the
 * default rather than failing the whole document, because losing a 4000-word
 * report over `accent: bluish` is a far worse outcome than a blue accent.
 */
export function resolveTheme(input: ThemeInput | undefined): DocTheme {
  const accentRaw = parseColor(input?.accent) ?? parseColor(DEFAULT_ACCENT)!;
  const inkRaw = parseColor(input?.ink) ?? parseColor(DEFAULT_INK)!;

  // Body text carries the strictest requirement (WCAG AA, 4.5:1). Headings and
  // links are large/bold, so 3:1 is enough and keeps a vivid brand colour vivid.
  const ink = darkenFor(inkRaw, 7);
  const accentDark = darkenFor(accentRaw, 3.2);
  const fonts = fontSet(input?.font);

  return {
    accent: toHex(accentRaw),
    accentDark: toHex(accentDark),
    accentSoft: toHex(mix(accentRaw, WHITE, 0.9)),
    accentFg: toHex(readableOn(accentRaw)),
    ink: toHex(ink),
    muted: toHex(mix(ink, WHITE, 0.45)),
    border: toHex(mix(ink, WHITE, 0.82)),
    codeFill: toHex(mix(ink, WHITE, 0.94)),
    codeInk: toHex(mix(ink, WHITE, 0.12)),
    // Marker pen, not the accent: a highlight has to sit *behind* body text, so
    // it is a fixed pale wash rather than the brand colour, which at full
    // saturation would leave the ink on top unreadable.
    highlightFill: 'FFF2A8',
    bodyFont: fonts.body,
    headingFont: fonts.heading,
    monoFont: MONO_STACK,
    officeBody: fonts.officeBody,
    officeHeading: fonts.officeHeading,
    officeMono: 'Consolas',
    cover: input?.cover,
    subtitle: input?.subtitle?.trim() || undefined,
    author: input?.author?.trim() || undefined,
  };
}

/**
 * Callout hues, shared by every renderer.
 *
 * Fixed, and deliberately NOT derived from the accent: a warning has to read as
 * a warning even in a blue-branded document. Kept here rather than in one
 * renderer so a `:::danger` box is the same red in the PDF, the .docx and the
 * .pptx — a document set where the same severity changes colour per format
 * looks like three different tools produced it.
 */
export const CALLOUT_PALETTE: Record<
  CalloutVariant,
  { readonly line: string; readonly fill: string; readonly ink: string }
> = {
  note: { line: '64748B', fill: 'F1F5F9', ink: '334155' },
  info: { line: '0284C7', fill: 'EFF6FF', ink: '075985' },
  tip: { line: '7C3AED', fill: 'F5F3FF', ink: '5B21B6' },
  success: { line: '16A34A', fill: 'F0FDF4', ink: '15803D' },
  warning: { line: 'D97706', fill: 'FFFBEB', ink: '92400E' },
  danger: { line: 'DC2626', fill: 'FEF2F2', ink: 'B91C1C' },
};

export const CALLOUT_TITLES: Record<CalloutVariant, string> = {
  note: 'Note',
  info: 'Info',
  tip: 'Tip',
  success: 'Success',
  warning: 'Warning',
  danger: 'Danger',
};

/**
 * How much content earns a cover page when the model didn't say.
 *
 * A cover on a three-paragraph note is a wasted sheet; on a report it is the
 * difference between "generated file" and "document". Blocks, not characters,
 * because a single long paragraph is still a note. Shared so the PDF and the
 * .docx of the same content agree on whether there is a cover.
 */
const COVER_MIN_BLOCKS = 8;

export function shouldUseCover(theme: DocTheme, blockCount: number): boolean {
  return theme.cover ?? blockCount >= COVER_MIN_BLOCKS;
}

/** `RRGGBB` to `#RRGGBB` for CSS. */
export const css = (hex: string): string => `#${hex}`;
