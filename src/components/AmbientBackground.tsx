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
      {/* Two soft radial gradients — one accent-tinted top glow, one cool base. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(80% 55% at 50% -10%, rgb(var(--accent) / 0.10), transparent 60%),' +
            'radial-gradient(60% 50% at 100% 0%, rgb(var(--accent-soft) / 0.06), transparent 55%)',
        }}
      />
      {hydrated && glow && (
        <div
          className="absolute left-1/2 top-[-20%] h-[42vh] w-[42vh] -translate-x-1/2 rounded-full opacity-[0.14]"
          style={{
            background: 'rgb(var(--accent))',
            // A single, static soft glow. `filter` is set once, never animated.
            filter: 'blur(80px)',
          }}
        />
      )}
      {/* Subtle noise texture via an inline SVG data URI (no network request). */}
      <div
        className="absolute inset-0 opacity-[0.015] mix-blend-soft-light"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  );
}
