const MARK = 'stroke-current fill-none';

/**
 * Six line marks drawn to match the hero's hairline language. Bespoke rather
 * than pulled from the icon set: at this size a generic glyph reads as filler,
 * and each of these encodes what its row actually describes.
 */
function Mark({ id }: { id: number }) {
  const common = {
    viewBox: '0 0 48 48',
    className: 'h-11 w-11 text-content/70',
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
    <section id="capabilities" className="relative px-6 py-20 sm:px-10 sm:py-28">
      <div className="hw-rule mb-10 sm:mb-14" />
      <p className="type-eyebrow mb-12 text-content">Capabilities</p>

      <ol className="space-y-0">
        {FEATURES.map((f, i) => (
          <li
            key={f.verb}
            className="grid grid-cols-1 items-start gap-x-8 gap-y-4 border-t-2 border-content/20 py-9 first:border-t-0 sm:py-11 lg:grid-cols-[auto_minmax(0,22rem)_minmax(0,1fr)_auto] lg:items-center"
          >
            {/* The numeral is a graphic element, not a list marker — hence the
                display face at display scale. */}
            <span className="hw-numeral shrink-0" aria-hidden>
              {i + 1}
            </span>

            <div>
              {/* `#N Verb` exactly as the reference sets it — the number is real
                  ordering information here (capability order, not decoration),
                  which is the only reason a numbered list earns its numbers. */}
              <p className="type-label mb-1.5 text-acid">{`#${i + 1} ${f.verb}`}</p>
              <h3 className="type-display text-[clamp(1.5rem,3.4vw,2.35rem)] text-content">
                {f.title}
              </h3>
            </div>

            <p className="max-w-prose text-[0.975rem] leading-relaxed text-content-muted">
              {f.body}
            </p>

            <div className="hidden shrink-0 justify-self-end lg:block">
              <Mark id={i + 1} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
