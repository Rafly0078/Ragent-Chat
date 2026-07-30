import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { HeroArt } from './HeroArt';
import { InstallBlock } from './InstallBlock';

/**
 * Hero: eyebrow, stacked display headline, one accent CTA, the terminal block,
 * and the generative mark carrying the right half.
 *
 * The headline is hard-broken into three lines rather than left to wrap. At
 * this size a wrap point that moves with the viewport is the difference between
 * a composed stack and an accident, and the reference sets its own headline the
 * same way.
 */
export function Hero() {
  return (
    <section className="relative px-6 pb-20 pt-16 sm:px-10 sm:pb-28 sm:pt-24">
      <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:gap-8">
        {/* Left: the thesis. */}
        <div className="relative z-10 max-w-3xl">
          <p className="type-eyebrow mb-6 text-content">Open source &middot; MIT License</p>

          {/* Sized so the longest hard-broken line ("LEAVE HOME") still fits the
              column at every width — the whole point of the stack is three
              deliberate lines, and a size that lets them re-wrap turns it into
              six accidental ones. */}
          <h1 className="type-display text-content [font-size:clamp(2.25rem,7.2vw,6rem)]">
            The models
            <br />
            that never
            <br />
            leave home
          </h1>

          <p className="mt-8 max-w-md text-[1.0625rem] leading-relaxed text-content-muted">
            A chat interface for the models already running on your own hardware. Streaming,
            reasoning, documents, and a sandbox that fixes its own code &mdash; with nothing
            travelling to anyone else&rsquo;s server.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/chat"
              className="focus-ring group inline-flex items-center gap-2.5 bg-white px-6 py-3.5 font-mono text-[0.8rem] uppercase tracking-[0.1em] text-[#0000f2] transition-transform active:translate-y-px"
            >
              Open chat
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <a
              href="#capabilities"
              className="focus-ring inline-flex items-center gap-2 border-2 border-content/60 px-6 py-3.5 font-mono text-[0.8rem] uppercase tracking-[0.1em] text-content transition-colors hover:border-content"
            >
              What it does
            </a>
          </div>

          <div className="mt-12">
            <InstallBlock />
          </div>
        </div>

        {/* Right: the mark. Decorative, so it drops out of the a11y tree on the
            small layout where it sits behind the text. */}
        <div className="pointer-events-none absolute inset-0 -z-0 flex items-center justify-center opacity-[0.13] lg:relative lg:z-10 lg:opacity-100">
          <HeroArt className="h-auto w-[130%] max-w-none text-content lg:w-full" />
        </div>
      </div>
    </section>
  );
}
