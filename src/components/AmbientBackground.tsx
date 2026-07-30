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
  // mismatch when the user had turned the texture off. Gate it on hydration.
  const hydrated = useHydrated();

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-surface">
      {/* Nothing but grain. A wash or glow tinted with the accent was pointless
          once the canvas became the accent — it was invisible against its own
          ground. Same feTurbulence parameters the reference uses (baseFrequency
          .72, 4 octaves, desaturated), tiled, so the chat and the landing share
          one texture. */}
      {hydrated && glow && (
        <div
          className="absolute inset-0 opacity-[0.3] mix-blend-overlay"
          style={{
            backgroundImage: 'var(--hw-noise)',
            backgroundSize: 'var(--hw-noise-tile) var(--hw-noise-tile)',
          }}
        />
      )}
    </div>
  );
}
