import type { Metadata, Viewport } from 'next';
import { Archivo, Bodoni_Moda, Courier_Prime } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';

/**
 * Type system transcribed from hermes-agent.nousresearch.com, with free
 * substitutes for the two faces Nous licenses privately:
 *
 *   displayFont "Sigurd Variable"  ->  Bodoni Moda   (high-contrast Didone)
 *   rulesFont   "Rules Variable"   ->  Archivo       (neutral grotesque)
 *   monoFont    "Courier Prime"    ->  Courier Prime (the actual face)
 *
 * The display face only ever appears in caps at .03em tracking, so its
 * lowercase quirks never show; what matters is the stroke contrast, which is
 * what makes the reference's stacked headlines read the way they do.
 */
const display = Bodoni_Moda({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

const sans = Archivo({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = Courier_Prime({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  weight: ['400', '700'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://ollama-chat.vercel.app'),
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
    url: 'https://ollama-chat.vercel.app',
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
  themeColor: [
    // #eceaf5 paper / #0a0a0c near-black — the two chat canvases.
    { media: '(prefers-color-scheme: light)', color: '#eceaf5' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0c' },
  ],
};

/**
 * Runs before first paint to set the theme class from persisted settings,
 * eliminating the wrong-theme flash on reload. Mirrors ThemeManager's
 * resolution so the two never disagree. Kept dependency-free and inlined; any
 * throw is swallowed so a corrupt store can't block rendering.
 */
const NO_FLASH_THEME = `(function(){try{var t='dark';var raw=localStorage.getItem('ollama-webui:settings');if(raw){var s=JSON.parse(raw);t=(s&&s.state&&s.state.theme)||'dark';}var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.classList.toggle('light',!d);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} dark`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME }} />
      </head>
      <body className="min-h-[100dvh] antialiased">
        <ServiceWorkerRegister />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
