import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { GenerationParams, PromptPreset } from '@/types';
import {
  ACCENT_PRESETS,
  DEFAULT_PARAMS,
  DEFAULT_PRESETS,
  DEFAULT_SYSTEM_PROMPT,
} from './defaults';

export type ThemeMode = 'dark' | 'light' | 'system';
export type ConnectionMode = 'direct' | 'bridge';

export interface SettingsState {
  theme: ThemeMode;
  accent: string; // one of ACCENT_PRESETS value
  /** User override for the API URL (falls back to env var when empty). */
  apiUrlOverride: string;
  /** 'direct': browser -> Ollama directly (no time limit, needs CORS).
   *  'bridge': browser -> same-origin server proxy -> Ollama (no CORS setup, capped by the host's function duration). */
  connectionMode: ConnectionMode;
  defaultModel: string;
  defaultSystemPrompt: string;
  defaultParams: GenerationParams;
  presets: PromptPreset[];
  animatedBackground: boolean;
  sendOnEnter: boolean; // Enter sends; Shift+Enter newline. If false, Ctrl+Enter sends.
  showTokenCounter: boolean;
  /** Auto-audit web code (HTML/CSS/JS) in a sandbox and let the model fix its
   *  own runtime errors. Off by default — it makes extra model calls. */
  sandboxAutoHeal: boolean;
  /** Max heal iterations per run before giving up. */
  sandboxMaxIterations: number;

  setTheme: (t: ThemeMode) => void;
  setAccent: (a: string) => void;
  setApiUrlOverride: (v: string) => void;
  setConnectionMode: (m: ConnectionMode) => void;
  setDefaultModel: (m: string) => void;
  setDefaultSystemPrompt: (s: string) => void;
  setDefaultParams: (p: Partial<GenerationParams>) => void;
  addPreset: (p: PromptPreset) => void;
  updatePreset: (id: string, patch: Partial<PromptPreset>) => void;
  removePreset: (id: string) => void;
  toggle: (
    key: 'animatedBackground' | 'sendOnEnter' | 'showTokenCounter' | 'sandboxAutoHeal',
  ) => void;
  setSandboxMaxIterations: (n: number) => void;
  /** Import settings from untrusted JSON (a user-picked file). */
  importSettings: (data: unknown) => void;
  reset: () => void;
}

const initial = {
  // Dark is the default canvas for the chat surface in the Hermes system;
  // the landing page is always the blue field regardless of this setting.
  theme: 'dark' as ThemeMode,
  accent: ACCENT_PRESETS[0]!.value,
  apiUrlOverride: '',
  connectionMode: 'direct' as ConnectionMode,
  defaultModel: '',
  defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
  defaultParams: DEFAULT_PARAMS,
  presets: DEFAULT_PRESETS,
  animatedBackground: true,
  sendOnEnter: true,
  showTokenCounter: true,
  sandboxAutoHeal: false,
  sandboxMaxIterations: 3,
};

/** Keys that hold data (everything else on the store is an action). */
type SettingsData = typeof initial;
const DATA_KEYS = Object.keys(initial) as (keyof SettingsData)[];

const THEMES: ThemeMode[] = ['dark', 'light', 'system'];
const MODES: ConnectionMode[] = ['direct', 'bridge'];

/**
 * Validate an imported settings blob against the known data keys.
 *
 * A bare `{...state, ...data}` spread let a hand-edited file overwrite the
 * store's own action methods (`{"setTheme": 1}` replaced the function with a
 * number). Because the store had no `partialize`, that value was then persisted
 * and re-applied on every load, and `reset()` — a shallow set of `initial` —
 * couldn't undo it. Unknown keys and wrong types are ignored now.
 */
function sanitizeSettings(raw: unknown): Partial<SettingsData> {
  if (!raw || typeof raw !== 'object') return {};
  const data = raw as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  for (const key of DATA_KEYS) {
    if (!(key in data)) continue;
    const value = data[key];
    const expected = typeof initial[key];

    if (key === 'theme') {
      if (THEMES.includes(value as ThemeMode)) patch[key] = value;
    } else if (key === 'connectionMode') {
      if (MODES.includes(value as ConnectionMode)) patch[key] = value;
    } else if (key === 'presets') {
      if (Array.isArray(value)) {
        patch[key] = value
          .filter(
            (p): p is PromptPreset =>
              !!p && typeof p === 'object' && typeof (p as PromptPreset).content === 'string',
          )
          .map((p) => ({
            id: typeof p.id === 'string' && p.id ? p.id : `${Date.now()}-${Math.random()}`,
            name: typeof p.name === 'string' && p.name ? p.name : 'Untitled preset',
            content: p.content,
          }));
      }
    } else if (key === 'defaultParams') {
      if (value && typeof value === 'object') {
        const merged = { ...DEFAULT_PARAMS } as Record<string, number>;
        for (const [pk, pv] of Object.entries(value as Record<string, unknown>)) {
          if (pk in merged && typeof pv === 'number' && Number.isFinite(pv)) merged[pk] = pv;
        }
        patch[key] = merged as unknown as GenerationParams;
      }
    } else if (key === 'sandboxMaxIterations') {
      if (typeof value === 'number' && Number.isFinite(value)) {
        patch[key] = Math.max(1, Math.min(8, Math.round(value)));
      }
    } else if (typeof value === expected) {
      patch[key] = value;
    }
  }

  return patch as Partial<SettingsData>;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...initial,
      setTheme: (theme) => set({ theme }),
      setAccent: (accent) => set({ accent }),
      setApiUrlOverride: (apiUrlOverride) => set({ apiUrlOverride }),
      setConnectionMode: (connectionMode) => set({ connectionMode }),
      setDefaultModel: (defaultModel) => set({ defaultModel }),
      setDefaultSystemPrompt: (defaultSystemPrompt) => set({ defaultSystemPrompt }),
      setDefaultParams: (p) =>
        set((s) => ({ defaultParams: { ...s.defaultParams, ...p } })),
      addPreset: (p) => set((s) => ({ presets: [...s.presets, p] })),
      updatePreset: (id, patch) =>
        set((s) => ({
          presets: s.presets.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        })),
      removePreset: (id) => set((s) => ({ presets: s.presets.filter((x) => x.id !== id) })),
      toggle: (key) => set((s) => ({ [key]: !s[key] }) as Partial<SettingsState>),
      setSandboxMaxIterations: (n) =>
        set({ sandboxMaxIterations: Math.max(1, Math.min(8, Math.round(n))) }),
      importSettings: (data) => set(sanitizeSettings(data) as Partial<SettingsState>),
      reset: () => set(initial),
    }),
    {
      name: 'ollama-webui:settings',
      storage: createJSONStorage(() => localStorage),
      version: 2,
      /**
       * v1 -> v2: the design system was rebased on the Hermes palette, where the
       * signature accent is electric blue. Anyone still on the *old default*
       * ('coral') is moved to the new default so the redesign actually lands;
       * a deliberately-picked accent is left alone. Same for the old light
       * default, since the chat canvas is now designed dark-first.
       */
      migrate: (persisted: unknown, version: number) => {
        if (!persisted || typeof persisted !== 'object') return persisted;
        const state = persisted as { accent?: string; theme?: string };
        if (version < 2) {
          if (state.accent === 'coral' || state.accent === 'blue') state.accent = 'electric';
          if (state.theme === 'light') state.theme = 'dark';
        }
        return state;
      },
      // Persist data only. Without this, anything that ever landed on the store
      // (including a clobbered action from a bad import) was written to disk and
      // restored on the next load.
      partialize: (s) =>
        Object.fromEntries(DATA_KEYS.map((k) => [k, s[k]])) as unknown as SettingsState,
    },
  ),
);
