import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { APP_NAME, APP_VERSION, LICENSE, REPO_URL } from '@/lib/app-meta';

/**
 * Closing CTA plus the reference's minimal footer: an oversized ghosted
 * wordmark, then one line each of version, project and licence. Nothing else.
 */
export function LandingFooter() {
  return (
    <footer className="relative overflow-hidden px-6 pt-20 sm:px-10 sm:pt-28">
      <div className="hw-rule mb-14 sm:mb-20" />

      {/* Action */}
      <div className="relative z-10 flex flex-col items-start gap-8 pb-20 sm:pb-28">
        <h2 className="type-display max-w-4xl text-[clamp(2.25rem,7.5vw,5.5rem)] text-content">
          Your machine. Your models. Your data.
        </h2>
        <Link href="/chat" className="btn-primary btn-xl group">
          Open chat
          <ArrowRight className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-1" />
        </Link>
      </div>

      {/* Ghosted wordmark, the reference's closing device. Sized to fit the
          viewport rather than bled off it — a word cut mid-letter reads as an
          overflow bug, not a deliberate crop. */}
      <div className="pointer-events-none w-full select-none" aria-hidden>
        <span className="hw-ghost block w-full text-center text-[15vw]">{APP_NAME}</span>
      </div>

      {/* Colophon */}
      <div className="hw-rule relative z-10 flex flex-wrap items-center justify-between gap-x-8 gap-y-3 py-7">
        <span className="type-label text-content">
          {APP_NAME} Chat {APP_VERSION}
        </span>
        <a
          href={REPO_URL}
          className="type-label focus-ring py-1.5 text-content-muted transition-colors duration-fast hover:text-content"
        >
          Source
        </a>
        <span className="type-label text-content-muted">{LICENSE} &middot; 2026</span>
      </div>
    </footer>
  );
}
