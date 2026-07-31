/**
 * Product identity constants.
 *
 * The version string and repo URL were each duplicated across the landing nav,
 * the landing footer and the settings colophon, which is how a product ends up
 * shipping two different version numbers on one page.
 */
export const APP_NAME = 'Ragent';
export const APP_VERSION = 'v1.0.0';
export const REPO_URL = 'https://github.com/Rafly0078/ollama-webui';
export const LICENSE = 'MIT License';

/**
 * The site's own origin, for `metadataBase`, Open Graph, robots and the sitemap.
 *
 * Never hardcode it. All four of those used to name `https://ollama-chat.vercel.app`,
 * which was not a domain this project has ever been served from — so every
 * canonical URL, OG url and sitemap entry pointed at someone else's host, and
 * renaming the Vercel alias could not have fixed it.
 *
 * Resolution order:
 *   1. NEXT_PUBLIC_SITE_URL   — set this once a real custom domain exists
 *   2. VERCEL_PROJECT_PRODUCTION_URL — injected by Vercel; the shortest
 *      production domain, so it follows an alias rename on its own
 *   3. localhost              — dev
 *
 * Server-only consumers, so the un-prefixed Vercel variable is fine.
 */
function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  return 'http://localhost:3000';
}

export const SITE_URL = resolveSiteUrl();
