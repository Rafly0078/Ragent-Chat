import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/app-meta';

/**
 * Allow crawling of public pages. The chat itself is a client-side SPA
 * behind auth, so we only expose the root and settings routes.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
