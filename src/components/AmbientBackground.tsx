'use client';

import { useSettings } from '@/lib/store/settings-store';
import { useHydrated } from '@/lib/hooks/use-hydrated';

/**
 * Ambient canvas for the app surfaces: the flat field, a masked grid, one lamp
 * pool, and film grain. Fully static — no animation, no canvas, no WebGL, no
 * particles. Costs one paint and nothing after that, which matters on a screen
 * people leave open for hours.
 *
 * The pool is what stops a flat field from reading as an empty void: it warms
 * the top of the page where the chrome is. It sits far below any text and lifts
 * the field by about 2% luminance, so the contrast ratios in globals.css still
 * hold wherever content actually sits.
 *
 * The grain is desktop-only. It is a 4-octave `feTurbulence` raster composited
 * with `mix-blend-mode: multiply`, and both halves of that cost scale with
 * viewport area — an expensive way to deliver a 3.5%-opacity texture nobody can
 * resolve on a phone held at arm's length.
 */
export function AmbientBackground() {
  const texture = useSettings((s) => s.animatedBackground);
  // The settings store rehydrates from localStorage before the first client
  // render, so reading a persisted flag during render produced a server/client
  // mismatch when the user had turned the texture off. Gate it on hydration.
  const hydrated = useHydrated();

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-surface">
      <div
        className="absolute inset-0 opacity-[0.32]"
        style={{
          backgroundImage:
            'linear-gradient(rgb(var(--border) / .035) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--border) / .035) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'linear-gradient(to bottom, black, transparent 72%)',
        }}
      />
      <div className="lamp-pool left-1/2 top-[-36vh] h-[76vh] w-[110vw] -translate-x-1/2 opacity-70" />

      {/* Grain: baseFrequency .72 / 4 octaves / desaturated, tiled. Lighter here
          than on the landing (0.035 vs 0.055) because text sits on it for hours. */}
      {hydrated && texture && (
        <div
          className="absolute inset-0 hidden opacity-[0.035] mix-blend-multiply md:block"
          style={{
            backgroundImage: 'var(--grain)',
            backgroundSize: 'var(--grain-tile) var(--grain-tile)',
          }}
        />
      )}
    </div>
  );
}
