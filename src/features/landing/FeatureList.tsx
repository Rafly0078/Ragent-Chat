import { Reveal } from './Reveal';

const MARK = 'stroke-current fill-none';

/**
 * Six line marks drawn to match the hero's hairline language. Bespoke rather
 * than pulled from the icon set: at this size a generic glyph reads as filler,
 * and each of these encodes what its row actually describes.
 */
function Mark({ id }: { id: number }) {
  const common = {
    viewBox: '0 0 48 48',
    className:
      'h-11 w-11 text-content-subtle transition-colors duration-base group-hover:text-accent',
    strokeWidth: 1.4,
    'aria-hidden': true,
  } as const;

  switch (id) {
    case 1: // stream — a pulse arriving left to right
      return (
        <svg {...common}>
          <path className={MARK} d="M2 24h8l4-9 5 18 5-13 4 8h4M40 24h6" />
          <circle className={MARK} cx="36" cy="24" r="3" />
        </svg>
      );
    case 2: // reason — nested deliberation
      return (
        <svg {...common}>
          <circle className={MARK} cx="24" cy="24" r="20" />
          <circle className={MARK} cx="24" cy="24" r="12" />
          <circle className={MARK} cx="24" cy="24" r="4" />
          <path className={MARK} d="M24 4v8M24 36v8M4 24h8M36 24h8" />
        </svg>
      );
    case 3: // remember — many lines folding into one
      return (
        <svg {...common}>
          <path className={MARK} d="M4 8h26M4 15h22M4 22h26M4 29h18" />
          <path className={MARK} d="M30 22c8 0 10 6 14 6" />
          <path className={MARK} d="M22 40h22" strokeWidth={2.4} />
        </svg>
      );
    case 4: // produce — a sheet with a folded corner
      return (
        <svg {...common}>
          <path className={MARK} d="M10 4h20l8 8v32H10z" />
          <path className={MARK} d="M30 4v8h8" />
          <path className={MARK} d="M16 24h16M16 31h16M16 38h10" />
        </svg>
      );
    case 5: // run — a frame with a play triangle
      return (
        <svg {...common}>
          <rect className={MARK} x="3" y="8" width="42" height="32" />
          <path className={MARK} d="M3 16h42" />
          <path className={MARK} d="M20 22l10 6-10 6z" />
        </svg>
      );
    default: // search — a globe with a meridian sweep
      return (
        <svg {...common}>
          <circle className={MARK} cx="24" cy="24" r="19" />
          <path className={MARK} d="M5 24h38" />
          <path className={MARK} d="M24 5c6 6 6 32 0 38M24 5c-6 6-6 32 0 38" />
        </svg>
      );
  }
}

const FEATURES = [
  {
    verb: 'Stream',
    title: 'Tokens as they land',
    body: 'Real streaming over NDJSON or SSE, abortable mid-sentence, with an idle watchdog so a dead tunnel surfaces as an error instead of a spinner that never stops.',
  },
  {
    verb: 'Reason',
    title: 'Thinking, on a dial',
    body: 'Extended reasoning at four effort levels, streamed into its own collapsible panel so you can read the working and then tuck it away.',
  },
  {
    verb: 'Remember',
    title: 'Context that compacts',
    body: 'As a conversation approaches the model’s window, older turns fold into a running summary instead of falling off the end.',
  },
  {
    verb: 'Produce',
    title: 'Files, not just replies',
    body: 'Ask for a document and get one: PDF, Word, PowerPoint, Excel, CSV, Markdown, HTML, JSON, XML, or a zipped project, rendered server-side.',
  },
  {
    verb: 'Run',
    title: 'A sandbox that self-heals',
    body: 'Runnable HTML, CSS and JS execute in a locked-down frame that collects the real runtime errors, hands them back to the model, and re-runs the fix.',
  },
  {
    verb: 'Search',
    title: 'The web, when it helps',
    body: 'The model plans its own queries, runs them through a server-side proxy that keeps your key private, and cites what it used.',
  },
];

export function FeatureList() {
  return (
    <section id="capabilities" className="relative px-6 pb-10 pt-24 sm:px-10 sm:pb-14 sm:pt-32">
      <div className="rule-t mb-12 sm:mb-16" />

      <Reveal className="mb-14 max-w-2xl sm:mb-20">
        <p className="type-eyebrow">Capabilities</p>
        <h2 className="type-display mt-5 text-[clamp(1.9rem,5vw,3.4rem)] text-content">
          Six things it does that a chat box usually doesn&rsquo;t
        </h2>
      </Reveal>

      {/* An ordered list because the order is real: this is the sequence a
          request actually moves through, from tokens arriving to the web being
          searched. The numbers are information, not markers. */}
      <ol>
        {FEATURES.map((f, i) => (
          <Reveal key={f.verb} delay={Math.min(i, 4) * 55}>
            <li className="border-border/12 group relative grid min-w-0 grid-cols-1 items-start gap-x-10 gap-y-4 border-t py-9 sm:py-11 lg:grid-cols-[3.5rem_minmax(0,20rem)_minmax(0,1fr)_auto] lg:items-center">
              {/* The rail: the lamp catching the row you are pointing at. Scaled
                  from the top so it wipes downward instead of fading in. */}
              <span
                aria-hidden
                className="absolute left-0 top-0 h-full w-[2px] origin-top scale-y-0 rounded-full bg-accent transition-transform duration-base ease-out group-hover:scale-y-100"
              />

              <span className="numeral" aria-hidden>
                {String(i + 1).padStart(2, '0')}
              </span>

              <div>
                <p className="type-label mb-2 text-accent">{f.verb}</p>
                <h3 className="type-display text-[clamp(1.35rem,3vw,1.9rem)] text-content">
                  {f.title}
                </h3>
              </div>

              <p className="max-w-prose text-[0.95rem] leading-relaxed text-content-muted">
                {f.body}
              </p>

              <div className="hidden shrink-0 justify-self-end transition-transform duration-base ease-out group-hover:-translate-y-1 lg:block">
                <Mark id={i + 1} />
              </div>
            </li>
          </Reveal>
        ))}
      </ol>
    </section>
  );
}
