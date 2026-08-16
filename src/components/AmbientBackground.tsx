'use client';

import { useSettings } from '@/lib/store/settings-store';
import { useHydrated } from '@/lib/hooks/use-hydrated';

/**
 * Ambient canvas for the app surfaces: the flat field, a masked grid, and film
 * grain. Fully static — no animation, no canvas, no WebGL, no particles. Costs
 * one paint and nothing after that, which matters on a screen people leave open
 * for hours.
 *
 * It serves two palettes now — warm paper on /settings, near-black on /chat — so
 * everything it paints is a token. The grain's blend mode is one of them: a
 * `multiply` texture is a shadow, and multiplying into a near-black field is a
 * no-op, so the terminal scope flips it to `screen` and it adds light instead.
 *
 * The lamp pool is gone with the paper field it warmed. It existed to stop a flat
 * surface reading as an empty void by lifting the top of the page ~2% where the
 * chrome sits; a terminal is supposed to read as a void, and on /settings the
 * form itself now carries that weight.
 *
 * The grain is desktop-only. It is a 4-octave `feTurbulence` raster composited
 * through a blend mode, and both halves of that cost scale with viewport area —
 * an expensive way to deliver a 2-3% texture nobody can resolve on a phone held
 * at arm's length.
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

      {hydrated && texture && <div className="ambient-grain hidden md:block" />}
    </div>
  );
}
