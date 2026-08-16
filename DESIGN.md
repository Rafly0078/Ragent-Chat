# Design

Source of truth for Ragent visual tokens and interaction rules.

## Direction - Quiet Machine

Ragent is a local-first AI workspace for people who care where their data goes.
The interface uses warm paper, graphite ink, ruled structure, and restrained
motion. Product proof comes from real chat surfaces, not decorative dashboards.

## Dials

- DESIGN_VARIANCE: 6 / 10
- MOTION_INTENSITY: 4 / 10
- VISUAL_DENSITY: 4 / 10

## Type

- Display: Unbounded. Hero headlines, product name, major statements.
- Interface: Inter. Navigation, body, controls, message copy, settings.
- Mono: JetBrains Mono. Model names, code, technical metadata.

Do not use Inter for hero-scale display. Keep display headlines under three lines
at common desktop widths.

The landing page is the one exception: it is a terminal surface, and its display
type is JetBrains Mono at negative tracking. Unbounded over an ASCII wave reads
as two unrelated pages. Prose there is still Inter — mono is for the headline,
the rails and the buttons, not for the sentence a visitor actually reads.

## Palette

- Field: `--linen` (warm off-white)
- Raised surface: `--slate`
- Floating surface: `--slate-lift`
- Ink: `--night`
- Deep code well: `--night-deep`
- Accent: graphite runtime preset, with grayscale alternatives only

Color creates hierarchy through tonal contrast, borders, and shadows. No purple,
blue, rainbow, neon, or decorative gradients. State colors remain reserved for
success, warning, and error feedback.

Two scoped inversions re-point the same tokens rather than introducing colours:
`.paper` (ink on warm white) and `.terminal-field` (white on `#101111`, the
landing page only, taken from the ASCII preset it sits behind).

## Shape and elevation

- Radius scale: 4 / 6 / 10 / 14 / 20 / 28px.
- Cards: one framed surface, no cards inside cards beyond a purposeful well.
- Shadows: tinted graphite, low opacity, short travel.
- Functional borders: stronger than decorative rules.

## Layout

- Chat reading column: 860px.
- Full-height app layouts use `min-h-[100dvh]`.
- Mobile collapses to one column; sidebar becomes a drawer; touch targets stay
  at least 44px.
- The landing page is one screen and does not scroll: full-bleed, `height:
100dvh` with the overflow clipped, one shared gutter for the rails and the
  content. It takes its scrollbar back under 520px of viewport height, where the
  composition stops being possible and clipping would hide the only action.
- Landing composition stays left-led and asymmetric: type in the left column,
  the ASCII field lit on the right.

## Motion

- Animate transform and opacity only.
- Entrances use one CSS class (`.enter`).
- Interactive motion uses the shared spring easing tokens.
- Streaming state remains visible and cancellable.
- Respect `prefers-reduced-motion`, including animation delays. A canvas has to
  opt in itself: the landing field draws one static frame under it, and the
  rotating headline does not rotate at all.

## Accessibility floor

- WCAG AA body contrast.
- Visible `:focus-visible` rings on every interactive control.
- Programmatic labels for all form controls.
- Semantic landmarks and keyboard navigation.
- Empty, loading, offline, and error states remain explicit.

## Project bans

- No generic AI gradient or centered template hero.
- No three equal feature cards in a row.
- No fake chat logic or mock replacement for existing API behavior.
- No emoji or raster UI icons.

## Last updated

2026-08-16 - landing page rebuilt from scratch as a single non-scrolling terminal
screen: scoped `.terminal-field` palette, mono display type, an ASCII ripple
canvas driven by `src/features/landing/ascii-flow.json`, and a headline line that
rewrites itself every 1.3s. The chat and settings surfaces are unchanged.

2026-08-08 - connection settings expanded for local and cloud providers while
preserving the Quiet Machine field, form hierarchy, spacing, and security copy.

2026-08-07 - complete monochrome visual redesign; functionality and data flow
unchanged.
