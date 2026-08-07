import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ProductPreview } from './ProductPreview';

/**
 * Hero: the thesis on the left, the working product on the right.
 *
 * The headline is hard-broken into two lines rather than left to wrap. Each line
 * gets its own overflow-hidden mask and rises out of it, which only reads as
 * deliberate if the break points are fixed — a wrap that moves with the viewport
 * turns the same animation into a stack of accidents.
 *
 * A server component. The entrance is CSS (see `.enter*` in globals.css).
 */

/** Models people actually run locally. Content, not decoration. */
const RUNS = [
  'llama3.3',
  'qwen2.5-coder',
  'gpt-oss',
  'deepseek-r1',
  'mistral-small',
  'phi4',
  'gemma3',
  'codestral',
  'nomic-embed-text',
];

const LINES = ['The models that', 'never leave home'];

/** One beat, so the whole hero reads as a single move rather than six. */
const beat = (ms: number) => ({ animationDelay: `${ms}ms` });

export function Hero() {
  return (
    <section className="relative">
      <div className="relative grid items-center gap-12 px-6 pb-16 pt-10 sm:px-10 sm:pb-24 sm:pt-16 lg:grid-cols-[1.04fr_0.96fr] lg:gap-10">
        {/* Left: the thesis. */}
        <div className="relative z-10 min-w-0">
          <p className="type-eyebrow enter" style={beat(80)}>
            Local models &middot; MIT licensed
          </p>

          <h1 className="type-mega mt-7 max-w-[13ch] text-[clamp(2.5rem,7.3vw,6rem)] text-content">
            {LINES.map((line, i) => (
              <span key={line} className="block overflow-hidden pb-[0.06em]">
                <span className="enter-line block" style={beat(160 + i * 110)}>
                  {line}
                </span>
              </span>
            ))}
          </h1>

          <p
            className="enter mt-7 max-w-[46ch] text-[1.05rem] leading-relaxed text-content-muted"
            style={beat(420)}
          >
            A chat interface for the models already running on your own hardware. Streaming,
            reasoning, documents, and a sandbox that fixes its own code &mdash; with nothing
            travelling to anyone else&rsquo;s server.
          </p>

          <div className="enter mt-9 flex flex-wrap items-center gap-3" style={beat(520)}>
            <Link href="/chat" className="btn-primary btn-xl group">
              Open chat
              <ArrowRight className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-1" />
            </Link>
            <a href="#capabilities" className="btn-surface btn-xl">
              See what it does
            </a>
          </div>
        </div>

        <div className="enter-pop relative z-10 lg:pl-6" style={beat(120)}>
          <ProductPreview />
          <p className="mt-5 text-center font-mono text-[0.68rem] uppercase tracking-[0.12em] text-content-subtle">
            private by default / your hardware, your history
          </p>
        </div>
      </div>

      {/* The ticker. Real model names, so the row carries information — it is the
          answer to "will it run what I have?", and it pauses on hover so you can
          actually read it. The track holds the list twice; the animation
          translates exactly -50%, which puts the seam back at the start. */}
      <div className="enter-fade relative border-y border-border/10 py-4" style={beat(700)}>
        <div className="marquee">
          <div className="marquee-track">
            {[0, 1].map((pass) => (
              <ul key={pass} className="flex items-center" aria-hidden={pass === 1}>
                {RUNS.map((name) => (
                  <li
                    key={name}
                    className="flex items-center gap-6 whitespace-nowrap px-6 font-mono text-[0.78rem] tracking-[0.06em] text-content-muted"
                  >
                    {name}
                    <span className="h-1 w-1 rounded-full bg-accent/60" />
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
