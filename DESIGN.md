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

Two families. Unbounded is gone: it was the display face for a wordmark and two
headings, and both terminal surfaces set their display type in mono instead.

- Interface: Inter. Prose, message copy, settings, controls.
- Mono: JetBrains Mono. Display type, rails, labels, model names, code, and
  anything the user typed.

On `/` and `/chat` the split is a rule, not a preference: mono is what the machine
and the operator say, Inter is what is being read. So the headline, the rails, the
buttons, the sidebar and your own echoed prompt are mono; the model's answer and
the one lede paragraph are Inter. Keep display headlines under three lines at
common desktop widths.

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

One scoped inversion re-points the same tokens rather than introducing colours:
`.terminal-field`, white on `#101111`, taken from the ASCII preset it sits behind.
It carries `/` and `/chat`; `/settings` and the document exports stay on paper.
Inside that scope the radius scale flattens to 2-4px, which is what makes the
shared primitives — `.popover`, `.input`, the `.btn` scale, the modal, the toast —
come out square without a second definition. Syntax highlighting is re-mapped onto
the three content tiers there too: hue is not a signal in this product, so code is
scanned by weight and brightness.

## Shape and elevation

- Radius scale: 4 / 6 / 10 / 14 / 20 / 28px on paper, flattened to 2 / 3 / 4px
  inside `.terminal-field`.
- Cards: one framed surface, no cards inside cards beyond a purposeful well. On
  the terminal there are no cards at all — a hairline and a label do that work.
- Shadows: tinted graphite, low opacity, short travel. They carry nothing on a
  near-black field, so the terminal surfaces lean on borders instead.
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
- The chat transcript has no bubbles. A turn is a labelled band — speaker, a
  hairline across the rest of the column, the time — and the body runs the full
  measure, so code, tables and generated documents are not paying for a border.
  Your own turn is echoed behind a `>`; the model's is bare.

## Motion

- Animate transform and opacity only.
- Entrances use one CSS class (`.enter`).
- Interactive motion uses the shared spring easing tokens.
- Streaming state remains visible and cancellable.
- Respect `prefers-reduced-motion`, including animation delays. A canvas has to
  opt in itself: both ASCII fields draw one static frame under it, and the
  rotating headline does not rotate at all.
- Thinking is shown, not spun. The chat's thinking state is the word THINKING at
  the reading column's full width, masked out of a flowing ASCII field driven by
  the same preset format as the landing. It appears only while a thinking block is
  actually streaming; before the first token there is just a caret, because the
  model may not have thinking enabled at all.

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

2026-08-16 - /chat rebuilt on the same terminal scope: labelled full-width turns
with no bubbles, a framed input dock, mono chrome, monochrome syntax highlighting,
and the THINKING wordmark filled with an ASCII flow field for the thinking state
(`public/thinking-mask.png`, applied as a `mask-image`). Unbounded dropped; `.paper`,
`.badge`, `.status-dot`, `.card`, `.lift` and the max-effort reasoning animations
removed with their last call sites. No logic changed.

2026-08-16 - landing page rebuilt from scratch as a single non-scrolling terminal
screen: scoped `.terminal-field` palette, mono display type, an ASCII ripple
canvas driven by `src/features/landing/ascii-flow.json`, and a headline line that
rewrites itself every 1.3s. The chat and settings surfaces are unchanged.

2026-08-08 - connection settings expanded for local and cloud providers while
preserving the Quiet Machine field, form hierarchy, spacing, and security copy.

2026-08-07 - complete monochrome visual redesign; functionality and data flow
unchanged.
