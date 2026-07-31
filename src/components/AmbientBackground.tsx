'use client';

import { useSettings } from '@/lib/store/settings-store';
import { useHydrated } from '@/lib/hooks/use-hydrated';

/**
 * Ambient canvas for the app surfaces: the night field, two lamp pools, and
 * film grain. Fully static — no animation, no canvas, no WebGL, no particles.
 * Costs one paint and nothing after that, which matters on a screen people
 * leave open for hours.
 *
 * The pools are what stop a near-black field from reading as an empty void:
 * one warms the top of the page where the chrome is, the other sits low and
 * centred, under the input dock, so the thing you type into is the brightest
 * part of the room. Both are far below any text — the brighter of the two lifts
 * the field by about 2% luminance, so contrast ratios in globals.css still hold
 * wherever content actually sits.
 */
export function AmbientBackground() {
  const texture = useSettings((s) => s.animatedBackground);
  // The settings store rehydrates from localStorage before the first client
  // render, so reading a persisted flag during render produced a server/client
  // mismatch when the user had turned the texture off. Gate it on hydration.
  const hydrated = useHydrated();

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-surface">
      <div className="lamp-pool left-1/2 top-[-28vh] h-[62vh] w-[120vw] -translate-x-1/2 opacity-50" />
      <div className="lamp-pool bottom-[-30vh] left-1/2 h-[52vh] w-[86vw] -translate-x-1/2 opacity-40" />

      {/* Grain: baseFrequency .72 / 4 octaves / desaturated, tiled. Lighter here
          than on the landing (0.10 vs 0.22) because text sits on it for hours. */}
      {hydrated && texture && (
        <div
          className="absolute inset-0 opacity-[0.1] mix-blend-soft-light"
          style={{
            backgroundImage: 'var(--grain)',
            backgroundSize: 'var(--grain-tile) var(--grain-tile)',
          }}
        />
      )}
    </div>
  );
}
