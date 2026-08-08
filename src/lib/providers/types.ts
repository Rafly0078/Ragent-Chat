export type ApiProvider =
  'ollama' | 'openai' | 'anthropic' | 'openrouter' | 'groq' | 'deepseek' | 'custom';

export type ProviderProtocol = 'openai' | 'anthropic';

export interface ProviderPreset {
  label: string;
  baseUrl: string;
  protocol: ProviderProtocol;
  apiKeyRequired: boolean;
}

export const PROVIDER_PRESETS: Record<Exclude<ApiProvider, 'ollama' | 'custom'>, ProviderPreset> = {
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
  if (provider === 'ollama') return 'Ollama';
  if (provider === 'custom') return 'Custom endpoint';
  return PROVIDER_PRESETS[provider].label;
}

export function providerProtocol(
  provider: Exclude<ApiProvider, 'ollama'>,
  customProtocol: ProviderProtocol,
): ProviderProtocol {
  return provider === 'custom' ? customProtocol : PROVIDER_PRESETS[provider].protocol;
}

export function providerBaseUrl(
  provider: Exclude<ApiProvider, 'ollama'>,
  customBaseUrl: string,
): string {
  return provider === 'custom'
    ? customBaseUrl.trim().replace(/\/+$/, '')
    : PROVIDER_PRESETS[provider].baseUrl;
}

export function providerNeedsApiKey(provider: ApiProvider): boolean {
  return provider !== 'ollama' && provider !== 'custom';
}
