import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Unbounded } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { SITE_URL } from '@/lib/app-meta';

// Three families, but only Inter earns a full variable axis — it sets nearly
// every string in the app. The other two are pinned to the weights actually
// referenced, which makes next/font ship those static instances instead of the
// whole axis: `--font-display` is only ever used at 600 (`.type-brand`,
// `.type-mega`, `.numeral`) and mono at 400/600. On a phone that is the
// difference between three variable files blocking first text and one.
//
// The landing page is set entirely in mono and Inter now, so `display` is a
// preload that page never spends — it is loaded here because the chat empty
// state and the sidebar brand do need it on their first paint.
const display = Unbounded({
  subsets: ['latin'],
  weight: ['600'],
  variable: '--font-display',
  display: 'swap',
});

const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

// Preloaded, which it was not before. Mono used to appear only in code blocks
// and model chips, none of which are on the critical path — but the landing page
// now sets its headline, both rails and both buttons in it, so on the entry
// route this is the face that blocks first text. Left unpreloaded it rendered
// that headline in the platform fallback and swapped, which also re-laid the
// ASCII grid out on the real advance width a beat later.
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '600'],
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
    // NOT favicon.svg. That file is a traced raster — 712 <path> nodes at
    // 2048x2048, 676 KB — and every visitor downloaded it to draw a 16px tab
    // icon. icon.svg is the same mark as real geometry, 755 bytes.
    icon: '/icon.svg',
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
