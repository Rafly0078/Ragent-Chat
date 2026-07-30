import type { MetadataRoute } from 'next';

/**
 * PWA Web App Manifest — makes the app installable on mobile homescreens.
 * Served at /manifest.webmanifest (Next.js handles the routing).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Ragent — private, local-first AI',
    short_name: 'Ragent',
    description:
      'A fast, beautiful ChatGPT-style interface for your local Ollama models. Streaming, Markdown, LaTeX, code, and more.',
    // The installed app opens straight into chat; `/` is the marketing page.
    start_url: '/chat',
    display: 'standalone',
    background_color: '#0a0a0c',
    theme_color: '#0000f2',
    orientation: 'any',
    categories: ['productivity', 'utilities', 'ai'],
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-192-maskable.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
