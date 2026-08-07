# Design

> Source of truth for colour, type, motion, layout, and component tokens.
> Read this before changing UI. Every number here is in the code; if you change
> one, change it in `globals.css` and update this file.

## Direction — "Lamplight"

The product's premise is that your models never leave your house. So the page is
lit like a room at night: a deep cold field (outside), one warm light source (the
lamp), warm-white paper where the light lands. Two colour temperatures, one light
source, and everything derives from it.

The signature is the light itself. It appears as `.lamp-pool` radial washes behind
the hero, the chat empty state, and the closing CTA; as the `--glow` shadow, spent
on exactly two things (the focused input dock and the hovered primary button); and
as the hero's `HeroCore` canvas — a wireframe room rotating around a warm core,
with the satellite nodes strictly inside the box.

## Dials

- DESIGN_VARIANCE: 6 / 10
- MOTION_INTENSITY: 5 / 10
- VISUAL_DENSITY: 5 / 10

## Type stack

| Role    | Face                | Notes                                                |
| ------- | ------------------- | ---------------------------------------------------- |
| display | Bricolage Grotesque | variable; set condensed (`wdth` 78–88) for headlines |
| body    | Instrument Sans     | slightly narrow, holds up at 15px on a dark ground   |
| mono    | JetBrains Mono      | labels, chips, buttons, code, metadata               |

`opsz` and `wdth` are requested explicitly in `layout.tsx` or
`font-variation-settings` has nothing to move. Roles: `.type-mega` (page
headlines), `.type-display` (section and card headings), `.type-label`,
`.type-eyebrow` (carries the lamp's dash via `::before`).

Banned as primary interface type: Inter, Roboto, Arial.

## Colour tokens

```css
--night: 11 16 32; /* #0B1020  the field */
--night-deep: 6 9 20; /* #060914  code wells, scrim */
--slate: 19 26 48; /* #131A30  raised surfaces */
--slate-lift: 27 36 63; /* #1B243F  floating surfaces */
--lamp: 255 182 92; /* #FFB65C  the light */
--ember: 255 122 69; /* #FF7A45  its hot core — gradients only */
--linen: 242 239 232; /* #F2EFE8  warm white */
--paper: 255 255 255; /* the paper inversion only */
```

Measured on the field: linen 16.8:1, lamp 11.1:1, `--content-muted` 7.0:1,
`--content-subtle` 4.6:1. All four pass AA for body text.

The lamp is both the accent colour and the accent fill — it is light enough to
carry night ink (11.1:1) and dark enough to read as a colour on the field, so
unlike the palette this replaced there is no text/fill split.

Accent is runtime-themeable (`ACCENT_PRESETS`: Lamp, Ember, Mint, Sky, Lilac,
Linen). Every preset clears 4.5:1 on the field in both directions.
`ThemeManager` writes `--accent`, `--accent-soft`, `--accent-solid`,
`--accent-hover`, `--lamp`, `--ember`.

Never use a purple-to-blue gradient.

## Elevation and shape

Surface-to-surface contrast on a near-black field is ~1.1:1 and no amount of
lifting fixes that. **A fill never carries a boundary here.** Boundaries are
borders and shadows; a fill only says "warmer or cooler than its neighbour".

- `--border-alpha: 0.12` — decorative dividers (1.35:1, deliberately quiet)
- `--border-strong: 0.38` — functional outlines (3.25:1, clears WCAG 1.4.11)
- `--shadow-1/2/3` — three elevation steps, all cast from the same imagined lamp
- `--glow` — the light landing on a surface; two uses only, see above
- Radius: 4 / 6 / 10 / 14 / 20 / 28px (`--radius-xs` … `--radius-2xl`)

## Component classes

`.card` (top hairline brighter than the other three), `.well` (recessed, for
nesting inside a card), `.popover` (overlay fill + functional border + shadow-3),
`.glass` (persistent chrome), `.paper` (full ink-on-white inversion — spent once,
on the landing's install card), `.lift` / `.edge-lit` (hover physics as tokens),
`.btn-primary|surface|ghost|destructive` × `.btn-sm|md|lg|xl`, `.input`,
`.badge` / `.badge-lit`, `.status-dot`, `.marquee`.

## Motion

- Durations `--dur-instant|fast|DEFAULT|slow` = 90 / 140 / 220 / 380ms
- Easings `--ease-out|in|inout|spring`; exit runs at ~65% of enter
- Only transform and opacity animate
- Entrances are **CSS** (`.enter`, `.enter-line`, `.enter-pop`, `.enter-fade`,
  `[data-reveal]`), never framer-motion `initial`. A framer `initial` is written
  into the server HTML, so slow or failed hydration leaves the page invisible.
- `Reveal` hides with JavaScript and skips anything already on screen, so no-JS
  degrades to "visible" rather than "blank"
- Reduced motion collapses duration **and delay**; framer components use `m`,
  never `motion` (`LazyMotion ... strict`)

## Layout

- Chat reading column: `max-w-[860px]` (`.chat-container`)
- Landing max width: `max-w-[1400px]`; section padding `pt-24 sm:pt-32`
- Hero: two columns at `lg`, the mark at `aspect-[7/5]` so it does not out-tall
  the text beside it
- No `h-screen`; use `100dvh`

## Project-specific bans

- No centered marketing hero, generic three-card feature row, or gradient headline
- No emoji icons and no raster PNG icons; Lucide or `BrandMark`
- No filler copy such as "Elevate", "Seamless", or "Unleash"
- No `shadow-card` on a `.popover` — it overrides the component's own shadow-3

## Accessibility floor

- WCAG AA body-text contrast, verified per token above
- Visible focus rings (`.focus-ring`)
- Every form control has a programmatic label; placeholders are hints only
- 44px interactive targets on mobile (`.btn-lg` and up)
- Reduced-motion support, including delays

## Last updated

2026-08-07 — accessibility audit: added programmatic form labels without
changing Lamplight tokens or layout.

2026-07-31 — replaced the mangled brown/olive palette (surfaces at 1.49:1, body
text at 4.02:1, no accent colour at all) with the Lamplight system; real radius
and shadow scales; CSS-driven entrances.
