import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { AsciiField } from '@/features/landing/AsciiField';
import { RotatingLine } from '@/features/landing/RotatingLine';
import { OpenChatShortcut } from '@/features/landing/OpenChatShortcut';
import { APP_NAME, APP_VERSION, LICENSE, REPO_URL } from '@/lib/app-meta';

export const metadata: Metadata = {
  title: 'Ragent — the models that run on your own machine',
};

// The rest of the product is warm paper; this one screen is a terminal. Without
// a route-level override a phone would keep drawing linen browser chrome around
// a near-black page.
//
// `metadata` and `viewport` are Server Component exports — a `'use client'`
// directive at the top of this file would stop both from being applied at all,
// which is why the canvas and the rotating line are separate client files.
export const viewport: Viewport = {
  themeColor: '#101111',
};

/** The product's own capability list, in the order its description states it. */
const CAPABILITIES = ['streaming', 'thinking', 'documents', 'sandbox', 'search'];

/** A status line is one line. Below `sm` the last two step out rather than wrap
 *  the rail onto a second row and eat into a viewport that cannot scroll. */
const RAIL_ON_PHONE = 3;

/**
 * Landing page: one screen, no scroll, terminal.
 *
 * `.terminal-lock` is what holds the promise — `height: 100dvh` with the
 * overflow clipped, so the document is exactly as tall as the viewport and there
 * is nothing to scroll. It hands the page back its scrollbar under 520px of
 * height, because at that point the one-screen composition is no longer
 * possible and clipping would hide the only action on the page.
 *
 * `.terminal-field` re-points the palette tokens at a near-black field, the same
 * way `.paper` does for the inverted panels elsewhere. Everything inside
 * re-grounds on its own because components read `rgb(var(--content))` and
 * `--border` rather than literals — including `Kbd`, which is borrowed from the
 * chat UI and needs no dark variant.
 *
 * The two rails are siblings of <main>, not children of it. Inside <main> a
 * <header> and a <footer> are generic containers; outside it they are the
 * `banner` and `contentinfo` landmarks, which is what the accessibility tree
 * should say about a wordmark row and a status row on a one-screen page.
 */
export default function LandingPage() {
  return (
    <div className="terminal-field terminal-lock relative flex w-full flex-col">
      <AsciiField />

      <header className="term-rail border-b">
        <span className="flex flex-none items-center gap-2.5 text-content">
          <span className="term-pip" />
          {APP_NAME.toLowerCase()}
        </span>
        <span className="flex flex-none items-center gap-2.5 text-content-subtle">
          {APP_VERSION}
          <span aria-hidden className="opacity-40">
            /
          </span>
          {LICENSE}
        </span>
      </header>

      {/* The session. `min-h-0` so this row is the one that gives when the
          viewport is short — the two rails keep their height, the field between
          them absorbs the loss. */}
      <main className="relative flex min-h-0 flex-1 items-center px-[var(--term-gutter)]">
        <div className="w-full">
          <h1 className="term-head text-content">
            {/* One stable sentence for screen readers and crawlers. The visible
                lines are decoration over it: the second one rewrites itself
                every 1.3s, and reading five variations of the same claim aloud
                is worse than reading the claim once. */}
            <span className="sr-only">
              {APP_NAME} — your models, on your own machine. Local Ollama or the cloud key you
              choose, in one quiet terminal.
            </span>
            <span aria-hidden className="block">
              your models.
            </span>
            <RotatingLine />
          </h1>

          <p className="term-lede">
            Local Ollama or the cloud key you choose. Every prompt goes only to the backend you
            point it at.
          </p>

          <div className="term-actions">
            <Link href="/chat" className="term-btn term-btn-solid focus-ring">
              open chat
              <span aria-hidden>&rarr;</span>
            </Link>
            {/* No trailing external-link glyph. `↗` has no outline in JetBrains
                Mono, so every platform fell back to its emoji font and drew a
                blue arrow tile in the middle of a monochrome page. */}
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="term-btn term-btn-ghost focus-ring"
            >
              source
            </a>
          </div>
        </div>
      </main>

      <footer className="term-rail border-t">
        {/* Each separator leads its own item, so the two that drop out on a phone
            take their slashes with them and the line never ends on one. */}
        <span className="flex flex-wrap items-center gap-x-2 text-content-subtle">
          {CAPABILITIES.map((capability, i) => (
            <span key={capability} className={i >= RAIL_ON_PHONE ? 'hidden sm:inline' : undefined}>
              {i > 0 && (
                <span aria-hidden className="pr-2 opacity-40">
                  /
                </span>
              )}
              {capability}
            </span>
          ))}
        </span>
        <span className="hidden text-content-subtle sm:flex">
          <OpenChatShortcut />
        </span>
      </footer>
    </div>
  );
}
