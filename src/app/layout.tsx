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
// `.type-mega`, `.ghost-word`, `.numeral`) and mono at 400/600. On a phone that
// is the difference between three variable files blocking first text and one.
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

// Not preloaded: mono appears in code blocks, model chips and the install
// snippet — none of which are on the critical path for first paint, and a
// preload for each competes with the two faces that are.
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-mono',
  display: 'swap',
  preload: false,
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
