'use client';

import { useEffect, useState } from 'react';
import { ACCENT_PRESETS } from '@/lib/store/defaults';
import { useSettings } from '@/lib/store/settings-store';
import { setApiOverride, setConnectionMode } from '@/lib/api/config';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Applies theme (dark/light/system) and accent color to the document root by
 * mutating CSS variables. Also propagates the API URL override to the API layer.
 * Runs entirely on the client after hydration.
 */
export function ThemeManager({ children }: { children: React.ReactNode }) {
  const theme = useSettings((s) => s.theme);
  const accent = useSettings((s) => s.accent);
  const apiUrlOverride = useSettings((s) => s.apiUrlOverride);
  const connectionMode = useSettings((s) => s.connectionMode);
  /**
   * Read straight from `matchMedia` in a lazy initializer rather than through
   * `useMediaQuery`, which is SSR-safe-false by design. With `false` on the
   * first client render, a `system` theme on a dark device got toggled to
   * `light` and then back to `dark` — re-introducing the exact flash the
   * NO_FLASH_THEME script in layout.tsx exists to prevent. Nothing renders
   * differently from this value (it only drives a classList toggle in an
   * effect), so there is no hydration mismatch.
   */
  const [prefersDark, setPrefersDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(DARK_QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(DARK_QUERY);
    const update = () => setPrefersDark(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    setApiOverride(apiUrlOverride);
  }, [apiUrlOverride]);

  useEffect(() => {
    setConnectionMode(connectionMode);
  }, [connectionMode]);

  useEffect(() => {
    const root = document.documentElement;
    const isDark = theme === 'dark' || (theme === 'system' && prefersDark);
    root.classList.toggle('dark', isDark);
    root.classList.toggle('light', !isDark);
  }, [theme, prefersDark]);

  useEffect(() => {
    const preset = ACCENT_PRESETS.find((a) => a.value === accent) ?? ACCENT_PRESETS[0]!;
    const root = document.documentElement;
    root.style.setProperty('--accent', preset.rgb);
    root.style.setProperty('--accent-soft', preset.soft);
    // Fills read the saturated value; text/icons read `--accent`. Keeping them
    // separate is what lets #0000f2 be the signature colour without failing
    // contrast as text on the dark canvas.
    root.style.setProperty('--accent-solid', preset.solid);
  }, [accent]);

  return <>{children}</>;
}
