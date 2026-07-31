import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Instrument_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { SITE_URL } from '@/lib/app-meta';

/**
 * Type system for the Lamplight direction.
 *
 *   display  Bricolage Grotesque  variable grotesque with a real width axis
 *   body     Instrument Sans      slightly narrow, holds up at 15px on a dark ground
 *   mono     JetBrains Mono       the face a developer tool should already be using
 *
 * The `wdth` and `opsz` axes have to be requested explicitly or
 * `font-variation-settings` in globals.css has nothing to move. The display
 * voice is set condensed (wdth 78-88), which is what keeps a long headline on
 * two or three lines instead of six.
 */
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  axes: ['opsz', 'wdth'],
});

const sans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Ragent — the models that run on your own machine',
  description:
    'A private, local-first chat interface for your own Ollama models. Streaming, extended thinking, document generation, a code sandbox, and web search — none of it leaves your hardware.',
  applicationName: 'Ragent',
  authors: [{ name: 'Ollama WebUI' }],
  keywords: ['ollama', 'ai', 'chat', 'llm', 'webui', 'local ai', 'private ai'],
  icons: {
    icon: '/favicon.svg',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.webmanifest',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    title: 'Ragent — the models that run on your own machine',
    description:
      'A private, local-first chat interface for your own Ollama models. Nothing leaves your hardware.',
    siteName: 'Ragent',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Ragent — the models that run on your own machine',
    description:
      'A private, local-first chat interface for your own Ollama models. Nothing leaves your hardware.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  // One canvas, so one theme colour: the field itself.
  themeColor: '#0B1020',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-[100dvh] bg-surface text-content antialiased">
        <ServiceWorkerRegister />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
