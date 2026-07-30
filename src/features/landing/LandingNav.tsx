import Link from 'next/link';
import { ArrowUpRight, Github } from 'lucide-react';

const REPO = 'https://github.com/Rafly0078/ollama-webui';

/**
 * Minimal nav in the reference's arrangement: two links left, the wordmark
 * centred with its social row beneath, one dropdown-ish link and the single
 * accent CTA right. Everything is mono caps at .1em tracking.
 *
 * On mobile the five slots collapse to wordmark + CTA — the secondary links
 * are all reachable from the page body, so hiding them beats a hamburger for
 * a page this short.
 */
export function LandingNav() {
  return (
    <header className="relative z-20 grid grid-cols-2 items-start gap-4 px-6 pt-6 sm:px-10 md:grid-cols-5">
      <a
        href={REPO}
        className="type-label focus-ring hidden text-content transition-opacity hover:opacity-70 md:block"
      >
        Source
      </a>
      <a
        href={`${REPO}#readme`}
        className="type-label focus-ring hidden text-content transition-opacity hover:opacity-70 md:block"
      >
        Docs
      </a>

      <div className="flex flex-col items-start gap-2 md:items-center">
        <Link href="/" className="focus-ring block">
          <span className="type-display block text-[1.35rem] leading-[0.86] text-content sm:text-[1.6rem]">
            Ragent
            <br className="hidden md:block" />
            <span className="md:hidden"> </span>
            AI
          </span>
        </Link>
        <a
          href={REPO}
          aria-label="Source on GitHub"
          className="focus-ring text-content/80 transition-opacity hover:opacity-100"
        >
          <Github className="h-4 w-4" />
        </a>
      </div>

      <a
        href="#capabilities"
        className="type-label focus-ring hidden text-content transition-opacity hover:opacity-70 md:block md:text-right"
      >
        Capabilities
      </a>

      <div className="flex items-start justify-end">
        <Link href="/chat" className="type-label focus-ring group inline-flex items-center gap-1.5 text-content">
          Open chat
          <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </Link>
      </div>
    </header>
  );
}
