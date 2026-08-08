import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Unbounded } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { SITE_URL } from '@/lib/app-meta';

const display = Unbounded({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const sans = Inter({
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
    'A private-by-design chat interface for local Ollama models and selected cloud providers. Streaming, extended thinking, document generation, a code sandbox, and web search.',
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
      'A private-by-design chat interface for local Ollama models and selected cloud providers.',
    siteName: 'Ragent',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Ragent — the models that run on your own machine',
    description:
      'A private-by-design chat interface for local Ollama models and selected cloud providers.',
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
  themeColor: '#F1F0EC',
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
