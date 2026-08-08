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

## Shape and elevation

- Radius scale: 4 / 6 / 10 / 14 / 20 / 28px.
- Cards: one framed surface, no cards inside cards beyond a purposeful well.
- Shadows: tinted graphite, low opacity, short travel.
- Functional borders: stronger than decorative rules.

## Layout

- Landing max width: 1400px.
- Chat reading column: 860px.
- Full-height layouts use `min-h-[100dvh]`.
- Mobile collapses to one column; sidebar becomes a drawer; touch targets stay
  at least 44px.
- Landing hero stays left-led and asymmetric. Product preview shows actual chat
  hierarchy and composer affordances.

## Motion

- Animate transform and opacity only.
- Entrances use CSS classes (`.enter`, `.enter-line`, `.enter-pop`, `.enter-fade`).
- Interactive motion uses the shared spring easing tokens.
- Streaming state remains visible and cancellable.
- Respect `prefers-reduced-motion`, including animation delays.

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

2026-08-08 - connection settings expanded for local and cloud providers while
preserving the Quiet Machine field, form hierarchy, spacing, and security copy.

2026-08-07 - complete monochrome visual redesign; functionality and data flow
unchanged.
