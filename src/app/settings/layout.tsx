import type { Metadata, Viewport } from 'next';

/**
 * A layout that renders nothing, purely to carry two Server Component exports the
 * page itself cannot: it is `'use client'`, and `metadata`/`viewport` are only
 * applied from a server module.
 *
 * `themeColor` is the one that matters. This page paints `.terminal-field`, so
 * without an override here a phone drew the root layout's warm linen chrome
 * around a near-black form — the same reason `/` and `/chat` each ship one. Only
 * that field is declared: viewport keys merge per field, so the root's width,
 * scale and `viewportFit` still apply.
 */
export const metadata: Metadata = {
  title: 'Ragent — settings',
};

export const viewport: Viewport = {
  themeColor: '#101111',
};

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
