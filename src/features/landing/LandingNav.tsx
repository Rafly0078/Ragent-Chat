'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Github } from 'lucide-react';
import { REPO_URL } from '@/lib/app-meta';
import { cn } from '@/lib/utils/cn';

/**
 * Landing nav: wordmark left, section links centre, one primary action right.
 *
 * The CTA is a real button rather than the text link it used to be — on the old
 * nav "Open chat" was styled identically to "Docs" and "Source", so the one
 * thing the page wants you to do looked like navigation.
 *
 * Sticky, and it solidifies once the page has moved. Detection is an
 * IntersectionObserver on a zero-height sentinel rather than a scroll listener,
 * so nothing runs on the main thread per scroll frame. Below `md` the section
 * links collapse and only the wordmark and the CTA remain; both targets are
 * still reachable from the page body, which beats a hamburger for a page this
 * short.
 */

const LINKS = [
  { href: '#capabilities', label: 'Capabilities' },
  { href: '#connect', label: 'Connect' },
  { href: `${REPO_URL}#readme`, label: 'Docs' },
];

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
          'sticky top-0 z-30 flex items-center justify-between gap-4 px-6 transition-all duration-base ease-out sm:px-10',
          stuck
            ? 'border-border/12 border-b bg-surface/85 py-3 backdrop-blur-xl'
            : 'border-b border-transparent bg-transparent py-5',
        )}
      >
        <Link href="/" className="focus-ring group flex items-center gap-2.5 rounded py-1">
          {/* The lit pip: the only warm mark in the chrome, so the wordmark reads
              as the source of the page's light rather than a logo slot. */}
          <span className="relative flex h-2 w-2">
            <span className="absolute inset-0 rounded-full bg-accent" />
            <span className="absolute -inset-1 rounded-full bg-accent/25 blur-[3px] transition-transform duration-base group-hover:scale-150" />
          </span>
          <span className="type-brand text-[1.08rem] leading-none text-content sm:text-[1.2rem]">
            Ragent
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Sections">
          {LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="type-label focus-ring hover:bg-border/8 rounded px-3 py-2 text-content-muted transition-colors duration-fast hover:text-content"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/chat" className="btn-ghost btn-md hidden sm:inline-flex">
            Log in
          </Link>
          <a
            href={REPO_URL}
            aria-label="Source on GitHub"
            className="btn-ghost btn-md btn-icon hidden sm:inline-flex"
          >
            <Github className="h-4 w-4" />
          </a>
          <Link href="/chat" className="btn-primary btn-md group">
            Open chat
            <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-fast group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
        </div>
      </header>
    </>
  );
}
