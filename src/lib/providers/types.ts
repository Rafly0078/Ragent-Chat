export type ApiProvider =
  'default' | 'ollama' | 'openai' | 'anthropic' | 'openrouter' | 'groq' | 'deepseek' | 'custom';

export type ProviderProtocol = 'openai' | 'anthropic';

/**
 * Whether this deployment ships a ready-to-use provider. The endpoint, key and
 * model live in server-only env vars (DEFAULT_OPENAI_*), so the browser only
 * learns that the option exists — never the credentials behind it.
 */
export const DEFAULT_PROVIDER_ENABLED = process.env.NEXT_PUBLIC_DEFAULT_PROVIDER_ENABLED === 'true';

export interface ProviderPreset {
  label: string;
  baseUrl: string;
  protocol: ProviderProtocol;
  apiKeyRequired: boolean;
}

export const PROVIDER_PRESETS: Record<
  Exclude<ApiProvider, 'default' | 'ollama' | 'custom'>,
  ProviderPreset
> = {
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    protocol: 'openai',
    apiKeyRequired: true,
  },
  anthropic: {
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    protocol: 'anthropic',
    apiKeyRequired: true,
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    protocol: 'openai',
    apiKeyRequired: true,
  },
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    protocol: 'openai',
    apiKeyRequired: true,
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    protocol: 'openai',
    apiKeyRequired: true,
  },
};

export interface ProviderConnection {
  provider: Exclude<ApiProvider, 'ollama'>;
  baseUrl: string;
  apiKey: string;
  protocol: ProviderProtocol;
}

export function providerLabel(provider: ApiProvider): string {
  if (provider === 'default') return 'Default (built-in)';
  if (provider === 'ollama') return 'Ollama';
  if (provider === 'custom') return 'Custom endpoint';
  return PROVIDER_PRESETS[provider].label;
}

export function providerProtocol(
  provider: Exclude<ApiProvider, 'ollama'>,
  customProtocol: ProviderProtocol,
): ProviderProtocol {
  // 'default' is resolved server-side from DEFAULT_OPENAI_*. Whatever the
  // browser sends for it is a placeholder the route ignores.
  if (provider === 'default') return 'openai';
  return provider === 'custom' ? customProtocol : PROVIDER_PRESETS[provider].protocol;
}

export function providerBaseUrl(
  provider: Exclude<ApiProvider, 'ollama'>,
  customBaseUrl: string,
): string {
  if (provider === 'default') return '';
  return provider === 'custom'
    ? customBaseUrl.trim().replace(/\/+$/, '')
    : PROVIDER_PRESETS[provider].baseUrl;
}

export function providerNeedsApiKey(provider: ApiProvider): boolean {
  return provider !== 'default' && provider !== 'ollama' && provider !== 'custom';
}
