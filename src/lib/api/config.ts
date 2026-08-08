/**
 * Central API configuration. The base URL comes from the environment and is
 * never hardcoded to localhost. A runtime override (set from Settings) can
 * replace it per-browser without a rebuild.
 */

import type { ApiProvider, ProviderConnection, ProviderProtocol } from '@/lib/providers/types';
import {
  providerBaseUrl,
  providerNeedsApiKey,
  providerProtocol as resolveProviderProtocol,
} from '@/lib/providers/types';

/** Build-time endpoint from the environment. Shown in the UI for reference. */
export const API_BASE_URL: string = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');

export const API_CONFIG_CHANGED_EVENT = 'ragent:api-config-changed';

// Optional per-browser override, injected by the settings layer after hydration.
let runtimeOverride: string | null = null;

/** Set/clear the runtime API URL override (called from ThemeManager). */
export function setApiOverride(url: string | null): void {
  runtimeOverride = url && url.trim() ? url.trim().replace(/\/+$/, '') : null;
}

/** The endpoint actually used for requests: override wins, else the env value. */
export function getApiBase(): string {
  return runtimeOverride || API_BASE_URL;
}

// Optional Bearer token for a token-protected endpoint, injected by the
// settings layer after hydration (direct mode only — see authHeaders()).
let runtimeToken: string | null = null;

/** Set/clear the per-browser upstream access token (called from ThemeManager). */
export function setApiToken(token: string | null): void {
  const clean = token?.trim().replace(/^Bearer\s+/i, '') ?? '';
  runtimeToken = clean || null;
}

export function getApiToken(): string | null {
  return runtimeToken;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
/** Streaming has no fixed length; use a longer idle guard instead. */
export const STREAM_IDLE_TIMEOUT_MS = 120_000;

export type ConnectionMode = 'direct' | 'bridge';

// Set from Settings (persisted) via ThemeManager, same pattern as the URL override.
let connectionMode: ConnectionMode = 'direct';

/** Switch between talking to Ollama directly and routing through the same-origin server proxy. */
export function setConnectionMode(mode: ConnectionMode): void {
  connectionMode = mode;
}

export function getConnectionMode(): ConnectionMode {
  return connectionMode;
}

let apiProvider: ApiProvider = 'ollama';
let providerApiUrl = '';
let providerApiKey = '';
let providerModel = '';
let customProviderProtocol: ProviderProtocol = 'openai';

export function setProviderConfig(config: {
  provider: ApiProvider;
  apiUrl: string;
  apiKey: string;
  model: string;
  protocol: ProviderProtocol;
}): void {
  apiProvider = config.provider;
  providerApiUrl = config.apiUrl.trim();
  providerApiKey = config.apiKey.trim();
  providerModel = config.model.trim();
  customProviderProtocol = config.protocol;
}

export function getApiProvider(): ApiProvider {
  return apiProvider;
}

export function getProviderModel(): string {
  return providerModel;
}

export function getProviderConnection(): ProviderConnection {
  if (apiProvider === 'ollama') {
    throw new ApiError('Cloud provider is not selected.', { kind: 'config' });
  }
  return {
    provider: apiProvider,
    baseUrl: providerBaseUrl(apiProvider, providerApiUrl),
    apiKey: providerApiKey,
    protocol: resolveProviderProtocol(apiProvider, customProviderProtocol),
  };
}

export function providerSupportsThinking(
  provider: ApiProvider = apiProvider,
  customProtocol: ProviderProtocol = customProviderProtocol,
): boolean {
  if (provider === 'ollama') return true;
  const protocol = resolveProviderProtocol(provider, customProtocol);
  return protocol === 'openai' || protocol === 'anthropic';
}

/** Scope runtime capability failures to the exact provider/protocol/model tuple. */
export function providerThinkingKey(
  model: string,
  provider: ApiProvider = apiProvider,
  customProtocol: ProviderProtocol = customProviderProtocol,
): string {
  const protocol =
    provider === 'ollama' ? 'ollama' : resolveProviderProtocol(provider, customProtocol);
  return `${provider}:${protocol}:${model}`;
}

/** Real Ollama endpoint path -> same-origin bridge route that proxies it server-side. */
const BRIDGE_ROUTES: Record<string, string> = {
  '/api/chat': '/api/bridge/chat',
  '/api/chat/stream': '/api/bridge/chat',
  '/api/tags': '/api/bridge/models',
  '/api/models': '/api/bridge/models',
  '/api/show': '/api/bridge/show',
};

/**
 * Whether the app can reach a model backend.
 * - direct mode: true when a direct Ollama URL is configured (build-time
 *   NEXT_PUBLIC_API_URL, or a per-browser override set in Settings).
 * - bridge mode: true as soon as the server proxy is enabled — its upstream
 *   is a server-only env var the browser can't read, so we optimistically
 *   report configured and let real errors surface at request time.
 */
export function apiConfigured(): boolean {
  if (apiProvider !== 'ollama') {
    const connection = getProviderConnection();
    if (!connection.baseUrl) return false;
    if (apiProvider === 'custom') {
      try {
        if (new URL(connection.baseUrl).protocol !== 'https:') return false;
      } catch {
        return false;
      }
    }
    return !providerNeedsApiKey(apiProvider) || Boolean(connection.apiKey);
  }
  if (connectionMode === 'bridge') {
    return process.env.NEXT_PUBLIC_DISABLE_BRIDGE !== 'true';
  }
  return Boolean(getApiBase());
}

/**
 * Build a URL for a request.
 * - direct mode (default): the browser talks straight to the configured
 *   Ollama-compatible endpoint — no server-side proxy involved, so a single
 *   long-running chat generation isn't bound by any serverless function time
 *   limit. Requires CORS (OLLAMA_ORIGINS) on the Ollama server.
 * - bridge mode: routed through the same-origin `/api/bridge/*` proxy, which
 *   forwards to a server-only OLLAMA_API_URL. No CORS setup needed, but a
 *   single request is capped by the hosting platform's function duration
 *   limit (e.g. 300s on Vercel Hobby).
 */
export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;

  if (apiProvider !== 'ollama') {
    if (normalized === '/api/tags' || normalized === '/api/models') {
      return '/api/providers/models';
    }
    if (normalized === '/api/chat' || normalized === '/api/chat/stream') {
      return '/api/providers/chat';
    }
    throw new ApiError(`Endpoint ${normalized} is only available for Ollama.`, { kind: 'config' });
  }

  if (connectionMode === 'bridge') {
    return BRIDGE_ROUTES[normalized] ?? normalized; // same-origin
  }

  const base = getApiBase();
  if (!base) {
    throw new ApiError(
      'API endpoint is not configured. Set NEXT_PUBLIC_API_URL, or set an API URL in Settings.',
      { kind: 'config' },
    );
  }
  return `${base}${normalized}`;
}

/**
 * Auth headers for an upstream request.
 *
 * Direct mode only. In bridge mode the token is a server-only env var
 * (OLLAMA_API_TOKEN) added inside lib/bridge/ollama.ts, so sending one from the
 * browser would just leak it to the network tab for nothing.
 *
 * Note the CORS cost: `Authorization` is not a safelisted request header, so as
 * soon as a token is set every direct request is preceded by an OPTIONS
 * preflight. Browsers strip credentials from a preflight, which means a token
 * proxy that authenticates OPTIONS the same way it authenticates POST will
 * answer 401 and the real request is never sent. The upstream must answer
 * OPTIONS with 2xx + `Access-Control-Allow-Headers: authorization, content-type`
 * *before* checking the token. When no token is set the request stays
 * preflight-free, exactly as before.
 */
export function authHeaders(): Record<string, string> {
  if (apiProvider !== 'ollama' || connectionMode === 'bridge' || !runtimeToken) return {};
  return { Authorization: `Bearer ${runtimeToken}` };
}

export type ApiErrorKind =
  'config' | 'network' | 'timeout' | 'aborted' | 'http' | 'parse' | 'unknown';

export class ApiError extends Error {
  kind: ApiErrorKind;
  status?: number;
  constructor(
    message: string,
    opts: { kind: ApiErrorKind; status?: number } = { kind: 'unknown' },
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = opts.kind;
    this.status = opts.status;
  }

  static from(err: unknown): ApiError {
    if (err instanceof ApiError) return err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      return new ApiError('Request was cancelled.', { kind: 'aborted' });
    }
    if (err instanceof TypeError) {
      // fetch throws TypeError on network/CORS failures.
      return new ApiError(
        'Could not reach the API. Check your connection, the API URL, and CORS on the server.',
        { kind: 'network' },
      );
    }
    return new ApiError(err instanceof Error ? err.message : 'Unknown error', { kind: 'unknown' });
  }

  get userMessage(): string {
    switch (this.kind) {
      case 'config':
        return this.message;
      case 'network':
        if (apiProvider !== 'ollama') {
          return 'Connection failed. The cloud provider may be offline or rejecting this server.';
        }
        return connectionMode === 'bridge'
          ? 'Connection failed. The Ollama server may be offline or unreachable from Vercel.'
          : 'Connection failed. The API server may be offline or blocking this origin (CORS).';
      case 'timeout':
        return 'The request timed out. The server took too long to respond.';
      case 'aborted':
        return 'Generation stopped.';
      case 'http':
        if ((this.status === 401 || this.status === 403) && apiProvider !== 'ollama') {
          return 'The provider rejected the API key. Check it in Settings → Connection.';
        }
        // A 401/403 straight from the model endpoint is not this app's own
        // sign-in wall — it's the tunnel in front of Ollama asking for its
        // token, which has its own field in Settings.
        if ((this.status === 401 || this.status === 403) && connectionMode === 'direct') {
          return runtimeToken
            ? 'The API endpoint rejected the access token. Re-copy it from the tunnel output in Settings → Connection.'
            : 'The API endpoint requires an access token. Paste it in Settings → Connection.';
        }
        return `The server returned an error${this.status ? ` (${this.status})` : ''}: ${this.message}`;
      default:
        return this.message || 'Something went wrong.';
    }
  }
}
