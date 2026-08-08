import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { APP_NAME, APP_VERSION, LICENSE, REPO_URL } from '@/lib/app-meta';
import { Reveal } from './Reveal';

/**
 * Closing CTA plus a minimal colophon: an oversized ghosted wordmark, then one
 * line each of version, project and licence. Nothing else.
 */
export function LandingFooter() {
  return (
    <footer className="relative overflow-hidden px-6 pt-24 sm:px-10 sm:pt-32">
      <div className="rule-t mb-16 sm:mb-24" />

      {/* Action. The lamp pool sits behind the headline, so the last thing on the
          page is also the brightest — the same move the hero opens with. */}
      <div className="relative">
        <div className="lamp-pool left-0 top-1/2 h-[130%] w-[70%] -translate-y-1/2 opacity-70" />
        <Reveal className="relative z-10 flex flex-col items-start gap-9 pb-24 sm:pb-32">
          <h2 className="type-mega max-w-[24ch] text-[clamp(2.4rem,7.6vw,5.5rem)] text-content">
            Your models. Your provider. Your choice.
          </h2>
          <Link href="/chat" className="btn-primary btn-xl group">
            Open chat
            <ArrowRight className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-1" />
          </Link>
        </Reveal>
      </div>

      {/* Ghosted wordmark. Sized to fit the viewport rather than bled off it — a
          word cut mid-letter reads as an overflow bug, not a deliberate crop. */}
      <div className="pointer-events-none w-full select-none" aria-hidden>
        <span className="ghost-word block w-full text-center text-[16vw]">{APP_NAME}</span>
      </div>

      {/* Colophon */}
      <div className="border-border/12 relative z-10 flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-t py-7">
        <span className="type-label text-content-muted">
          {APP_NAME} {APP_VERSION}
        </span>
        <a
          href={REPO_URL}
          className="type-label focus-ring rounded py-1.5 text-content-muted transition-colors duration-fast hover:text-content"
        >
          Source
        </a>
        <span className="type-label text-content-subtle">{LICENSE} &middot; 2026</span>
      </div>
    </footer>
  );
}
