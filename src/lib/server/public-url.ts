import 'server-only';

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * SSRF guard for any URL the server is about to fetch on someone else's behalf.
 *
 * Extracted from `validateCustomBaseUrl` in lib/providers/server.ts, which had
 * the only copy of these rules. `fetch_url` needs exactly the same checks — a
 * tool that fetches a model-chosen URL from inside the deployment is the textbook
 * SSRF surface, with cloud metadata endpoints (169.254.169.254) as the first
 * target — so the logic lives here and both callers share it rather than the
 * second one growing a weaker version.
 *
 * The check is DNS-aware on purpose: a public hostname that resolves to
 * 127.0.0.1 or a link-local address is the standard bypass, so every resolved
 * address is inspected, not just the literal in the URL.
 */

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedUrlError';
  }
}

function blockedIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    return true;
  const [a, b, c] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function blockedIpv6(address: string): boolean {
  const value = address.toLowerCase().split('%')[0]!;
  if (value === '::' || value === '::1') return true;
  const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return blockedIpv4(mapped);
  const first = Number.parseInt(value.split(':')[0] || '0', 16);
  return (
    (first >= 0xfc00 && first <= 0xfdff) ||
    (first >= 0xfe80 && first <= 0xfebf) ||
    first >= 0xff00 ||
    value.startsWith('2001:db8:') ||
    value === '2001:db8::' ||
    value.startsWith('2001:0:') ||
    value.startsWith('2002:') ||
    value.startsWith('64:ff9b:')
  );
}

/** True when this literal IP must never be dialled. Unparseable counts as blocked. */
export function blockedAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? blockedIpv4(address) : family === 6 ? blockedIpv6(address) : true;
}

/** Hostnames that name something inside the network regardless of what DNS says. */
function blockedHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.home.arpa')
  );
}

/**
 * Throw unless `url`'s host is public. Resolves the hostname and rejects if ANY
 * returned address is private or reserved — a name with one public and one
 * loopback record must not be reachable.
 */
export async function assertPublicHost(url: URL): Promise<void> {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (blockedHostname(hostname)) {
    throw new BlockedUrlError('That host is not publicly routable.');
  }
  if (isIP(hostname)) {
    if (blockedAddress(hostname)) {
      throw new BlockedUrlError('Private and reserved addresses are blocked.');
    }
    return;
  }
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new BlockedUrlError(`Could not resolve "${hostname}".`);
  }
  if (!addresses.length || addresses.some((entry) => blockedAddress(entry.address))) {
    throw new BlockedUrlError(`"${hostname}" resolves to a private or reserved address.`);
  }
}

export interface PublicUrlOptions {
  /** Allow `?query` and `#fragment`. Off for provider endpoints, on for fetch_url. */
  allowQuery?: boolean;
  /** Permit http:// as well as https://. Off by default. */
  allowHttp?: boolean;
  maxLength?: number;
}

/**
 * Parse and vet a URL that the server will fetch. Returns the parsed URL so the
 * caller uses the normalized form rather than re-parsing the raw string.
 */
export async function assertPublicUrl(raw: string, opts: PublicUrlOptions = {}): Promise<URL> {
  const { allowQuery = false, allowHttp = false, maxLength = 2_048 } = opts;
  if (!raw || raw.length > maxLength) throw new BlockedUrlError('That is not a usable URL.');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError('That is not a usable URL.');
  }

  const httpsOnly = !allowHttp;
  if (httpsOnly && url.protocol !== 'https:') {
    throw new BlockedUrlError('The URL must use HTTPS.');
  }
  if (!httpsOnly && url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BlockedUrlError('Only http and https URLs are supported.');
  }
  // Credentials in a URL are both a leak vector and a way to smuggle a different
  // authority past a naive host check (`https://evil.com@127.0.0.1/`).
  if (url.username || url.password) {
    throw new BlockedUrlError('The URL cannot contain credentials.');
  }
  if (!allowQuery && (url.search || url.hash)) {
    throw new BlockedUrlError('The URL cannot contain a query or fragment.');
  }

  await assertPublicHost(url);
  return url;
}
