import type { Config } from 'tailwindcss';

/**
 * Design tokens are CSS variables (see globals.css) so the accent stays
 * runtime-themeable and every surface restyles from one place.
 *
 * Values here are transcribed from hermes-agent.nousresearch.com:
 *   radius scale  0 / 4px / 1rem      (the reference uses only these three)
 *   tracking      .03em display, .1–.18em mono
 *   leading       .8 / .88 / 1 / 1.4 / 1.5
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
          /** The fill tier. On the #0000f2 field this resolves to paper. */
          solid: 'rgb(var(--accent-solid) / <alpha-value>)',
          hover: 'rgb(var(--accent-hover) / <alpha-value>)',
        },
        /** Acid yellow #edff45 — the reference's true accent. Highlights, never body text. */
        acid: 'rgb(var(--acid) / <alpha-value>)',
        /**
         * The two fixed poles of the palette, context-independent. `paper` and
         * `ink` exist so the landing's white-block-on-blue inversions stop being
         * `bg-white text-[#0000f2]` literals.
         */
        paper: 'rgb(var(--hermes-paper) / <alpha-value>)',
        ink: 'rgb(var(--hermes-blue) / <alpha-value>)',
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
        /** Bodoni Moda — stands in for the reference's proprietary Sigurd Variable. */
        display: ['var(--font-display)', 'Times New Roman', 'serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        /** Courier Prime — the face the reference actually ships. */
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        none: '0',
        sm: '0',
        DEFAULT: '4px',
        md: '4px',
        lg: '4px',
        xl: '4px',
        '2xl': '4px',
        '3xl': '1rem',
        full: '9999px',
      },
      letterSpacing: {
        display: '0.03em',
        label: '0.1em',
        eyebrow: '0.14em',
        wide: '0.18em',
      },
      lineHeight: {
        stack: '0.8',
        display: '0.88',
        flat: '1',
        body: '1.5',
      },
      fontSize: {
        // Fluid scale from the reference's --u unit (see globals.css).
        eyebrow: ['clamp(0.68rem, calc(18 * var(--u)), 0.92rem)', { lineHeight: '1.4' }],
        'body-fluid': ['clamp(0.8rem, calc(22 * var(--u)), 1.35rem)', { lineHeight: '1.5' }],
        h3: ['clamp(1.1rem, calc(40 * var(--u)), 2.5rem)', { lineHeight: '1' }],
      },
      boxShadow: {
        // The reference has no soft shadows anywhere — depth comes from flat
        // colour blocks and 2px rules. These are kept as no-ops so existing
        // `shadow-card` / `shadow-subtle` classes stay valid but render flat.
        subtle: 'none',
        card: 'none',
        /** 4-way inset rule, transcribed from --hermes-outline-inset. */
        rule: '2px 0 0 0 rgb(var(--border)), -2px 0 0 0 rgb(var(--border)), 0 2px 0 0 rgb(var(--border)), 0 -2px 0 0 rgb(var(--border))',
      },
      /**
       * Motion tokens, so `duration-*` / `ease-*` utilities and the CSS
       * component classes read from the same four values. Anything that animates
       * in this product picks one of these; nothing invents its own timing.
       */
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
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'caret-blink': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.2' },
        },
        'bounce-dot': {
          '0%, 80%, 100%': { transform: 'scale(0.6)', opacity: '0.4' },
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
        // Streaming placeholder: transform-only sweep, no layout, no repaint of
        // anything but the bar itself.
        scan: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(300%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out both',
        'caret-blink': 'caret-blink 1s steps(2, start) infinite',
        'bounce-dot': 'bounce-dot 1.2s infinite ease-in-out',
        'rise-in': 'rise-in 0.5s cubic-bezier(0, 0, 0.2, 1) both',
        'orbit-slow': 'orbit-slow 120s linear infinite',
        scan: 'scan 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite',
      },
    },
  },
  plugins: [],
};

export default config;
