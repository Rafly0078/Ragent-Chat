import type { Config } from 'tailwindcss';

/**
 * Design tokens are CSS variables (see globals.css) so the whole product
 * restyles from one place and the accent stays runtime-themeable.
 *
 * The scales here are the "Quiet Machine" system:
 *   radius     4 / 6 / 10 / 14 / 20 / 28px — a real scale, not one value
 *   shadow     three elevation steps plus `glow`, the lamp landing on a surface
 *   motion     four durations, four easings, read from CSS variables
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
        /** The light itself. Alias of --accent; kept so `text-acid` call sites resolve. */
        acid: 'rgb(var(--acid) / <alpha-value>)',
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
        /** Legacy alias for the darkest ink available on the current ground. */
        ink: 'rgb(var(--night) / <alpha-value>)',
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
        '3xl': '2.25rem',
        full: '9999px',
      },
      letterSpacing: {
        display: '-0.025em',
        label: '0.08em',
        eyebrow: '0.14em',
        wide: '0.18em',
      },
      lineHeight: {
        stack: '0.88',
        display: '0.94',
        flat: '1',
        body: '1.6',
      },
      fontSize: {
        // Fluid scale from the `--u` unit (see globals.css).
        eyebrow: ['clamp(0.66rem, calc(17 * var(--u)), 0.8rem)', { lineHeight: '1.4' }],
        'body-fluid': ['clamp(0.9rem, calc(23 * var(--u)), 1.2rem)', { lineHeight: '1.6' }],
        h3: ['clamp(1.2rem, calc(40 * var(--u)), 2.5rem)', { lineHeight: '1.05' }],
      },
      boxShadow: {
        // Depth is cast from the same imagined lamp everywhere: a tight dark
        // drop plus a wide soft ambient. `glow` is the light itself landing on
        // a surface — spent only on the focused input and hovered primary.
        subtle: 'var(--shadow-1)',
        card: 'var(--shadow-1)',
        raised: 'var(--shadow-2)',
        float: 'var(--shadow-3)',
        glow: 'var(--glow)',
        rule: 'inset 0 1px 0 0 rgb(var(--border) / 0.2)',
      },
      transitionDuration: {
        instant: 'var(--dur-instant)',
        fast: 'var(--dur-fast)',
        DEFAULT: 'var(--dur)',
        base: 'var(--dur)',
        slow: 'var(--dur-slow)',
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
        'bounce-dot': {
          '0%, 80%, 100%': { transform: 'scale(0.6)', opacity: '0.35' },
          '40%': { transform: 'scale(1)', opacity: '1' },
        },
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(18px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'orbit-slow': {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(360deg)' },
        },
        // Streaming placeholder: transform-only sweep, no layout.
        scan: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(300%)' },
        },
        // The lamp breathing. Used behind the hero mark and nowhere else.
        breathe: {
          '0%, 100%': { opacity: '0.55', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.06)' },
        },
      },
      animation: {
        'fade-in': 'fade-in var(--dur) var(--ease-out) both',
        'caret-blink': 'caret-blink 1.1s steps(2, start) infinite',
        'bounce-dot': 'bounce-dot 1.2s infinite ease-in-out',
        'rise-in': 'rise-in var(--dur-slow) var(--ease-out) both',
        'orbit-slow': 'orbit-slow 120s linear infinite',
        scan: 'scan 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite',
        breathe: 'breathe 7s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
