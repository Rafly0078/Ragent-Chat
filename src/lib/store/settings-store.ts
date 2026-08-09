import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { GenerationParams, PromptPreset } from '@/types';
import { ACCENT_PRESETS, DEFAULT_PARAMS, DEFAULT_PRESETS, DEFAULT_SYSTEM_PROMPT } from './defaults';
import { browserStorage } from './storage';
import type { ApiProvider, ProviderProtocol } from '@/lib/providers/types';
import { DEFAULT_PROVIDER_ENABLED } from '@/lib/providers/types';

export type ThemeMode = 'dark' | 'light' | 'system';
export type ConnectionMode = 'direct' | 'bridge';

export interface SettingsState {
  theme: ThemeMode;
  accent: string; // one of ACCENT_PRESETS value
  /** User override for the API URL (falls back to env var when empty). */
  apiUrlOverride: string;
  /** Bearer token for a token-protected endpoint (direct mode only). Kept in
   *  this browser's localStorage; bridge mode uses the server's OLLAMA_API_TOKEN
   *  instead so nothing is exposed to the client. */
  apiToken: string;
  /** 'direct': browser -> Ollama directly (no time limit, needs CORS).
   *  'bridge': browser -> same-origin server proxy -> Ollama (no CORS setup, capped by the host's function duration). */
  connectionMode: ConnectionMode;
  /** Active model backend. Ollama preserves the existing direct/bridge modes. */
  apiProvider: ApiProvider;
  /** Custom provider base URL. Known providers use audited presets. */
  providerApiUrl: string;
  /** Cloud API key. Persisted only in this browser and excluded from exports. */
  providerApiKey: string;
  /** Manual model id, used when the provider has no model-list endpoint. */
  providerModel: string;
  /** Wire format used by a custom endpoint. */
  providerProtocol: ProviderProtocol;
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
  setApiToken: (v: string) => void;
  setConnectionMode: (m: ConnectionMode) => void;
  setApiProvider: (p: ApiProvider) => void;
  setProviderApiUrl: (v: string) => void;
  setProviderApiKey: (v: string) => void;
  setProviderModel: (v: string) => void;
  setProviderProtocol: (p: ProviderProtocol) => void;
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
  // The product has one canvas (the night field), so this no longer drives
  // anything; it is kept so the export/import format stays stable.
  theme: 'dark' as ThemeMode,
  accent: ACCENT_PRESETS[0]!.value,
  apiUrlOverride: '',
  apiToken: '',
  connectionMode: 'direct' as ConnectionMode,
  apiProvider: DEFAULT_PROVIDER_ENABLED
    ? ('default' as ApiProvider)
    : process.env.NEXT_PUBLIC_DEFAULT_AI_PROVIDER === 'custom'
      ? ('custom' as ApiProvider)
      : ('ollama' as ApiProvider),
  providerApiUrl: DEFAULT_PROVIDER_ENABLED
    ? ''
    : (process.env.NEXT_PUBLIC_DEFAULT_AI_API_URL?.trim() ?? ''),
  providerApiKey: '',
  providerModel: DEFAULT_PROVIDER_ENABLED
    ? ''
    : (process.env.NEXT_PUBLIC_DEFAULT_AI_MODEL?.trim() ?? ''),
  providerProtocol:
    process.env.NEXT_PUBLIC_DEFAULT_AI_PROTOCOL === 'anthropic'
      ? ('anthropic' as ProviderProtocol)
      : ('openai' as ProviderProtocol),
  defaultModel: DEFAULT_PROVIDER_ENABLED
    ? ''
    : (process.env.NEXT_PUBLIC_DEFAULT_AI_MODEL?.trim() ?? ''),
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
const PROVIDERS: ApiProvider[] = [
  'default',
  'ollama',
  'openai',
  'anthropic',
  'openrouter',
  'groq',
  'deepseek',
  'custom',
];
const PROVIDER_PROTOCOLS: ProviderProtocol[] = ['openai', 'anthropic'];

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
    } else if (key === 'apiProvider') {
      if (PROVIDERS.includes(value as ApiProvider)) patch[key] = value;
    } else if (key === 'providerProtocol') {
      if (PROVIDER_PROTOCOLS.includes(value as ProviderProtocol)) patch[key] = value;
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
      setApiToken: (apiToken) => set({ apiToken }),
      setConnectionMode: (connectionMode) => set({ connectionMode }),
      setApiProvider: (apiProvider) =>
        set({
          apiProvider,
          // 'default' keeps every credential field empty: endpoint, key and model
          // are server-only env vars, so there is nothing to prefill here.
          providerApiUrl:
            apiProvider === 'custom'
              ? (process.env.NEXT_PUBLIC_DEFAULT_AI_API_URL?.trim() ?? '')
              : '',
          providerApiKey: '',
          providerModel:
            apiProvider === 'custom'
              ? (process.env.NEXT_PUBLIC_DEFAULT_AI_MODEL?.trim() ?? '')
              : '',
          defaultModel:
            apiProvider === 'custom'
              ? (process.env.NEXT_PUBLIC_DEFAULT_AI_MODEL?.trim() ?? '')
              : '',
          providerProtocol:
            apiProvider === 'custom' && process.env.NEXT_PUBLIC_DEFAULT_AI_PROTOCOL === 'anthropic'
              ? 'anthropic'
              : 'openai',
        }),
      setProviderApiUrl: (providerApiUrl) => set({ providerApiUrl }),
      setProviderApiKey: (providerApiKey) => set({ providerApiKey }),
      setProviderModel: (providerModel) => set({ providerModel }),
      setProviderProtocol: (providerProtocol) =>
        set((state) =>
          state.providerProtocol === providerProtocol
            ? {}
            : { providerProtocol, providerModel: '', defaultModel: '' },
        ),
      setDefaultModel: (defaultModel) => set({ defaultModel }),
      setDefaultSystemPrompt: (defaultSystemPrompt) => set({ defaultSystemPrompt }),
      setDefaultParams: (p) => set((s) => ({ defaultParams: { ...s.defaultParams, ...p } })),
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
      storage: createJSONStorage(browserStorage),
      version: 8,
      /**
       * v* -> v4: the product moved from a colored field to the monochrome system,
       * which renamed every accent preset (Acid, Paper and Peach no longer
       * exist). Any accent that isn't one of the current presets falls back to
       * the default rather than leaving `--accent` pointing at a colour that was
       * measured against a field this app no longer has.
       */
      migrate: (persisted: unknown, version: number) => {
        if (!persisted || typeof persisted !== 'object') return persisted;
        const state = persisted as {
          accent?: string;
          apiProvider?: ApiProvider;
          providerProtocol?: ProviderProtocol;
          apiUrlOverride?: string;
          providerApiKey?: string;
          defaultParams?: GenerationParams;
        };
        if (version < 4) {
          const known = new Set(ACCENT_PRESETS.map((a) => a.value));
          if (!state.accent || !known.has(state.accent)) state.accent = ACCENT_PRESETS[0]!.value;
        }
        if (version < 5) {
          state.apiProvider = 'ollama';
          state.providerProtocol = 'openai';
        }
        if (version < 6 && process.env.NEXT_PUBLIC_DEFAULT_AI_PROVIDER === 'custom') {
          state.apiProvider = 'custom';
          state.providerProtocol =
            process.env.NEXT_PUBLIC_DEFAULT_AI_PROTOCOL === 'anthropic' ? 'anthropic' : 'openai';
          Object.assign(state, {
            providerApiUrl: process.env.NEXT_PUBLIC_DEFAULT_AI_API_URL?.trim() ?? '',
            providerModel: process.env.NEXT_PUBLIC_DEFAULT_AI_MODEL?.trim() ?? '',
            defaultModel: process.env.NEXT_PUBLIC_DEFAULT_AI_MODEL?.trim() ?? '',
          });
        }
        /**
         * v7 introduces the built-in "Default" provider. Existing visitors are
         * moved onto it only when they never got a working setup of their own —
         * no Ollama URL and no cloud key. Someone who pasted their own
         * credentials keeps the provider they chose; switching them to a shared
         * endpoint would silently redirect their traffic (and their bill).
         */
        if (version < 7 && DEFAULT_PROVIDER_ENABLED) {
          const configured =
            Boolean(state.apiUrlOverride?.trim()) || Boolean(state.providerApiKey?.trim());
          if (!configured) {
            state.apiProvider = 'default';
            state.providerProtocol = 'openai';
            Object.assign(state, { providerApiUrl: '', providerModel: '', defaultModel: '' });
          }
        }
        /**
         * v8 raises the default context window to 131072. The old default of
         * 8192 predates the models this app now points at and silently truncated
         * long chats through the compaction path. Only the untouched old default
         * is rewritten — someone who deliberately picked a smaller window keeps
         * it, since a larger `num_ctx` costs memory on a self-hosted Ollama.
         */
        if (version < 8 && state.defaultParams?.contextLength === 8192) {
          state.defaultParams = { ...state.defaultParams, contextLength: 131072 };
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
