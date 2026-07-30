'use client';

import { useSettings } from '@/lib/store/settings-store';
import { useHydrated } from '@/lib/hooks/use-hydrated';

/**
 * Ambient background per the design brief: subtle radial gradients, a soft noise
 * texture, and a single minimal glow. Fully static — no animation, no canvas,
 * no WebGL, no particles. Costs zero CPU/GPU after paint and is battery-safe.
 *
 * The "animatedBackground" setting only toggles the extra glow tint; the base
 * gradients always render because they're free (single paint).
 */
export function AmbientBackground() {
  const glow = useSettings((s) => s.animatedBackground);
  // The settings store rehydrates from localStorage before the first client
  // render, so reading a persisted flag during render produced a server/client
  // mismatch when the user had turned the glow off. Gate it on hydration.
  const hydrated = useHydrated();

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-surface">
      {/* The reference has no soft glows anywhere — depth comes from flat colour
          and film grain. So: one flat wash of the signature blue anchored to the
          top edge (no blur, no radial falloff to muddy the canvas), then grain
          at the reference's own feTurbulence settings. */}
      {hydrated && glow && (
        <div
          className="absolute inset-x-0 top-0 h-[38vh]"
          style={{
            background:
              'linear-gradient(to bottom, rgb(var(--accent-solid) / 0.22), transparent)',
          }}
        />
      )}

      {/* Grain: baseFrequency .72 / 4 octaves / desaturated, tiled — the same
          filter the reference uses, so both surfaces share one texture. */}
      <div
        className="absolute inset-0 opacity-[0.035] mix-blend-overlay"
        style={{
          backgroundImage: 'var(--hw-noise)',
          backgroundSize: 'var(--hw-noise-tile) var(--hw-noise-tile)',
        }}
      />
    </div>
  );
}
