'use client';

import { useEffect } from 'react';
import { ACCENT_PRESETS } from '@/lib/store/defaults';
import { useSettings } from '@/lib/store/settings-store';
import {
  API_CONFIG_CHANGED_EVENT,
  setApiOverride,
  setApiToken,
  setConnectionMode,
  setProviderConfig,
} from '@/lib/api/config';

/**
 * Applies the accent choice to the document root and propagates the API URL
 * override to the API layer. Runs entirely on the client after hydration.
 *
 * There is no theme resolution: the product has one monochrome canvas, so there
 * is no dark/light class to toggle and no wrong-theme flash to guard against.
 * The `theme` setting is left in the store — harmless, and it keeps the
 * export/import format stable — but nothing reads it.
 */
export function ThemeManager({ children }: { children: React.ReactNode }) {
  const accent = useSettings((s) => s.accent);
  const apiUrlOverride = useSettings((s) => s.apiUrlOverride);
  const apiToken = useSettings((s) => s.apiToken);
  const connectionMode = useSettings((s) => s.connectionMode);
  const apiProvider = useSettings((s) => s.apiProvider);
  const providerApiUrl = useSettings((s) => s.providerApiUrl);
  const providerApiKey = useSettings((s) => s.providerApiKey);
  const providerModel = useSettings((s) => s.providerModel);
  const providerProtocol = useSettings((s) => s.providerProtocol);

  useEffect(() => {
    setApiOverride(apiUrlOverride);
    setApiToken(apiToken);
    setConnectionMode(connectionMode);
    setProviderConfig({
      provider: apiProvider,
      apiUrl: providerApiUrl,
      apiKey: providerApiKey,
      model: providerModel,
      protocol: providerProtocol,
    });
    const timer = window.setTimeout(
      () => window.dispatchEvent(new Event(API_CONFIG_CHANGED_EVENT)),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [
    apiUrlOverride,
    apiToken,
    connectionMode,
    apiProvider,
    providerApiUrl,
    providerApiKey,
    providerModel,
    providerProtocol,
  ]);

  useEffect(() => {
    const preset = ACCENT_PRESETS.find((a) => a.value === accent) ?? ACCENT_PRESETS[0]!;
    const root = document.documentElement;
    // Four properties, because the accent is a light source rather than a single
    // swatch: the colour itself, its brighter step, its fill (identical here —
    // every preset already carries night ink at 4.5:1+), and the hot stop the
    // gradients and lamp pools blend toward.
    root.style.setProperty('--accent', preset.rgb);
    root.style.setProperty('--accent-soft', preset.soft);
    root.style.setProperty('--accent-solid', preset.solid);
    root.style.setProperty('--accent-hover', preset.soft);
    root.style.setProperty('--lamp', preset.rgb);
    root.style.setProperty('--ember', preset.ember);
  }, [accent]);

  return <>{children}</>;
}
