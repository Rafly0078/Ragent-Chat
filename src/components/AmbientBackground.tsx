'use client';

import { useSettings } from '@/lib/store/settings-store';
import { useHydrated } from '@/lib/hooks/use-hydrated';

/**
 * Ambient canvas: the field, plus the reference's film grain. Fully static — no
 * animation, no canvas, no WebGL, no particles, no blur. Costs nothing after
 * paint and is battery-safe.
 *
 * There is deliberately no wash or glow layer. Every candidate tint measured
 * within 1.2:1 of #0000f2, so a gradient here would have cost a full-viewport
 * paint to produce something invisible — and the one time it was visible it was
 * because `--accent-solid` resolves to paper on this field, which hazed the top
 * of the app white. The grain is the only texture the field needs; it is lighter
 * here than on the landing (0.14 vs 0.28) because text sits on it for hours.
 */
export function AmbientBackground() {
  const texture = useSettings((s) => s.animatedBackground);
  // The settings store rehydrates from localStorage before the first client
  // render, so reading a persisted flag during render produced a server/client
  // mismatch when the user had turned the texture off. Gate it on hydration.
  const hydrated = useHydrated();

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-surface">
      {/* Grain: baseFrequency .72 / 4 octaves / desaturated, tiled — the same
          filter the reference uses, so the app and the landing share a texture. */}
      {hydrated && texture && (
        <div
          className="absolute inset-0 opacity-[0.14] mix-blend-overlay"
          style={{
            backgroundImage: 'var(--hw-noise)',
            backgroundSize: 'var(--hw-noise-tile) var(--hw-noise-tile)',
          }}
        />
      )}
    </div>
  );
}
