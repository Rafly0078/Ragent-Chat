import type { Metadata, Viewport } from 'next';

/**
 * A layout that renders nothing, purely to carry two Server Component exports the
 * page itself cannot: it is `'use client'`, and `metadata`/`viewport` are only
 * applied from a server module.
 *
 * The one that matters is `themeColor`. The root layout declares the warm linen
 * field, and without an override here a phone would draw linen browser chrome
 * around a near-black app.
 */
export const metadata: Metadata = {
  title: 'Ragent — chat',
};

export const viewport: Viewport = {
  themeColor: '#101111',
};

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return children;
}
