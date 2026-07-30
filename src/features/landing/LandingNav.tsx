'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Github } from 'lucide-react';
import { REPO_URL } from '@/lib/app-meta';
import { cn } from '@/lib/utils/cn';

/**
 * Landing nav, in the reference's arrangement: two links left, the wordmark
 * centred with its social row beneath, one section link and the CTA right.
 * Everything is mono caps at .1em tracking.
 *
 * The wordmark is one line. Stacked as "Ragent / AI" it was badly lopsided — the
 * reference can stack because "Hermes" and "Agent" are the same width, and a
 * two-character second line under a six-character first line reads as a wrap
 * bug rather than a lockup.
 *
 * Sticky, and it solidifies once the page has moved. Detection is an
 * IntersectionObserver on a zero-height sentinel rather than a scroll listener,
 * so nothing runs on the main thread per scroll frame. On mobile the five slots
 * collapse to wordmark + CTA; the secondary links are all reachable from the
 * page body, which beats a hamburger for a page this short.
 */
export function LandingNav() {
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setStuck(!entry?.isIntersecting), {
      threshold: 1,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinel} aria-hidden className="h-px w-full" />
      <header
        className={cn(
          'sticky top-0 z-30 grid grid-cols-2 items-start gap-4 px-6 transition-[padding,background-color,border-color] duration-base ease-out sm:px-10 md:grid-cols-5',
          stuck
            ? 'border-b-2 border-border bg-surface py-4'
            : 'border-b-2 border-transparent bg-transparent pb-4 pt-6',
        )}
      >
        <a
          href={REPO_URL}
          className="type-label focus-ring hidden text-content transition-opacity duration-fast hover:opacity-70 md:block"
        >
          Source
        </a>
        <a
          href={`${REPO_URL}#readme`}
          className="type-label focus-ring hidden text-content transition-opacity duration-fast hover:opacity-70 md:block"
        >
          Docs
        </a>

        <div className="flex flex-col items-start gap-1.5 md:items-center">
          <Link href="/" className="focus-ring block">
            <span className="type-display block whitespace-nowrap text-[1.35rem] leading-none text-content sm:text-[1.6rem]">
              Ragent AI
            </span>
          </Link>
          <a
            href={REPO_URL}
            aria-label="Source on GitHub"
            className="focus-ring text-content/80 transition-opacity duration-fast hover:opacity-100"
          >
            <Github className="h-3.5 w-3.5" />
          </a>
        </div>

        <a
          href="#capabilities"
          className="type-label focus-ring hidden text-content transition-opacity duration-fast hover:opacity-70 md:block md:text-right"
        >
          Capabilities
        </a>

        <div className="flex items-start justify-end">
          <Link
            href="/chat"
            className="type-label focus-ring group inline-flex items-center gap-1.5 text-content"
          >
            Open chat
            <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-fast group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>
      </header>
    </>
  );
}
