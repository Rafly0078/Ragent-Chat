import type { MetadataRoute } from 'next';

/**
 * PWA Web App Manifest — makes the app installable on mobile homescreens.
 * Served at /manifest.webmanifest (Next.js handles the routing).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Ragent — local and cloud AI',
    short_name: 'Ragent',
    description:
      'A fast, beautiful chat interface for local Ollama and cloud models. Streaming, Markdown, LaTeX, code, and more.',
    // The installed app opens straight into chat; `/` is the marketing page.
    start_url: '/chat',
    display: 'standalone',
    // Both are `.terminal-field`'s `--surface` (globals.css), because that is
    // what `start_url` paints. As linen they made every cold start flash a white
    // splash before chat drew, and tinted the task switcher.
    background_color: '#101111',
    theme_color: '#101111',
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
