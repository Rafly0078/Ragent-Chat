'use client';

import { useEffect } from 'react';
import { ACCENT_PRESETS } from '@/lib/store/defaults';
import { useSettings } from '@/lib/store/settings-store';
import { setApiOverride, setConnectionMode } from '@/lib/api/config';

/**
 * Applies the accent choice to the document root and propagates the API URL
 * override to the API layer. Runs entirely on the client after hydration.
 *
 * There is no theme resolution any more: the product has one canvas (#0000f2),
 * so there is no dark/light class to toggle and no wrong-theme flash to guard
 * against. The `theme` setting is left in the store — harmless, and it keeps the
 * export/import format stable — but nothing reads it.
 */
export function ThemeManager({ children }: { children: React.ReactNode }) {
  const accent = useSettings((s) => s.accent);
  const apiUrlOverride = useSettings((s) => s.apiUrlOverride);
  const connectionMode = useSettings((s) => s.connectionMode);

  useEffect(() => {
    setApiOverride(apiUrlOverride);
  }, [apiUrlOverride]);

  useEffect(() => {
    setConnectionMode(connectionMode);
  }, [connectionMode]);

  useEffect(() => {
    const preset = ACCENT_PRESETS.find((a) => a.value === accent) ?? ACCENT_PRESETS[0]!;
    const root = document.documentElement;
    // `--accent` is text/icons, `--accent-solid` is fills. On this field they can
    // never be the same colour: a fill has to be light enough to sit under blue
    // ink, and accent text has to be light enough to sit on the blue ground.
    root.style.setProperty('--accent', preset.rgb);
    root.style.setProperty('--accent-soft', preset.soft);
    root.style.setProperty('--accent-solid', preset.solid);
  }, [accent]);

  return <>{children}</>;
}
