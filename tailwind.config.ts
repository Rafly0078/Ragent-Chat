import type { Config } from 'tailwindcss';

/**
 * Design tokens are CSS variables (see globals.css) so the whole product
 * restyles from one place and the accent stays runtime-themeable.
 *
 * The scales here are the "Quiet Machine" system:
 *   radius     4 / 6 / 10 / 14 / 20 / 28px — a real scale, not one value
 *   shadow     three elevation steps plus `glow`, the lamp landing on a surface
 *   motion     two durations, four easings, read from CSS variables
 *
 * Only tokens with call sites live here. The CSS variables in globals.css are
 * the full system; this file is the bridge for the subset the components use,
 * so an unused entry is dead weight in the generated stylesheet, not a spare.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          soft: 'rgb(var(--accent-soft) / <alpha-value>)',
          fg: 'rgb(var(--accent-fg) / <alpha-value>)',
          solid: 'rgb(var(--accent-solid) / <alpha-value>)',
          hover: 'rgb(var(--accent-hover) / <alpha-value>)',
        },
        /** The lamp and its hot core — for gradients and marks, never body text. */
        lamp: 'rgb(var(--lamp) / <alpha-value>)',
        ember: 'rgb(var(--ember) / <alpha-value>)',
        /** The two fixed poles of the palette, context-independent. */
        linen: 'rgb(var(--linen) / <alpha-value>)',
        paper: 'rgb(var(--paper) / <alpha-value>)',
        night: {
          DEFAULT: 'rgb(var(--night) / <alpha-value>)',
          deep: 'rgb(var(--night-deep) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          raised: 'rgb(var(--surface-raised) / <alpha-value>)',
          overlay: 'rgb(var(--surface-overlay) / <alpha-value>)',
          mid: 'rgb(var(--surface-mid) / <alpha-value>)',
        },
        border: 'rgb(var(--border) / <alpha-value>)',
        content: {
          DEFAULT: 'rgb(var(--content) / <alpha-value>)',
          muted: 'rgb(var(--content-muted) / <alpha-value>)',
          subtle: 'rgb(var(--content-subtle) / <alpha-value>)',
        },
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        error: 'rgb(var(--error) / <alpha-value>)',
      },
      fontFamily: {
        /** Unbounded — used only for brand and hero-scale display type. */
        display: ['var(--font-display)', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        none: '0',
        sm: 'var(--radius-xs)',
        DEFAULT: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
        full: '9999px',
      },
      letterSpacing: {
        /** Overrides Tailwind's own `wide` (0.025em) — the eyebrow/label tracking. */
        wide: '0.18em',
      },
      boxShadow: {
        // Depth is cast from the same imagined lamp everywhere: a tight dark
        // drop plus a wide soft ambient. `glow` is the light itself landing on
        // a surface — spent only on the focused input and hovered primary.
        subtle: 'var(--shadow-1)',
        raised: 'var(--shadow-2)',
        float: 'var(--shadow-3)',
        glow: 'var(--glow)',
      },
      transitionDuration: {
        fast: 'var(--dur-fast)',
        /** `DEFAULT` is what a bare `transition-*` picks up; `base` is the explicit name. */
        DEFAULT: 'var(--dur)',
        base: 'var(--dur)',
      },
      transitionTimingFunction: {
        DEFAULT: 'var(--ease-out)',
        out: 'var(--ease-out)',
        in: 'var(--ease-in)',
        inout: 'var(--ease-inout)',
        spring: 'var(--ease-spring)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'caret-blink': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.15' },
        },
        // Streaming placeholder: transform-only sweep, no layout.
        scan: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(300%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in var(--dur) var(--ease-out) both',
        'caret-blink': 'caret-blink 1.1s steps(2, start) infinite',
        scan: 'scan 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite',
      },
    },
  },
  plugins: [],
};

export default config;
