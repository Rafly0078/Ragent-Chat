/**
 * The reference's platform cards, mapped to this app's real choice: how the
 * browser reaches your models. Two options, so two cards — a third would be
 * padding, and each gets its own diagram rather than a shared icon.
 */

function BridgeDiagram() {
  return (
    <svg viewBox="0 0 200 90" className="h-auto w-full text-content/75" aria-hidden>
      <g stroke="currentColor" fill="none" strokeWidth={1.3}>
        <rect x="4" y="30" width="44" height="30" />
        <rect x="78" y="30" width="44" height="30" />
        <rect x="152" y="30" width="44" height="30" />
        {/* Same-origin hop, drawn solid: no CORS to negotiate. */}
        <path d="M48 45h30M122 45h30" />
        <path d="M72 41l6 4-6 4M146 41l6 4-6 4" />
      </g>
      <g fill="currentColor" className="font-mono" fontSize="7" letterSpacing="0.1em">
        <text x="26" y="72" textAnchor="middle">
          BROWSER
        </text>
        <text x="100" y="72" textAnchor="middle">
          BRIDGE
        </text>
        <text x="174" y="72" textAnchor="middle">
          OLLAMA
        </text>
      </g>
    </svg>
  );
}

function DirectDiagram() {
  return (
    <svg viewBox="0 0 200 90" className="h-auto w-full text-content/75" aria-hidden>
      <g stroke="currentColor" fill="none" strokeWidth={1.3}>
        <rect x="4" y="30" width="44" height="30" />
        <rect x="152" y="30" width="44" height="30" />
        {/* One long dashed hop — it crosses an origin, hence CORS. */}
        <path d="M48 45h104" strokeDasharray="5 4" />
        <path d="M146 41l6 4-6 4" />
        <circle cx="100" cy="45" r="9" />
        <path d="M96 45h8M100 41v8" />
      </g>
      <g fill="currentColor" className="font-mono" fontSize="7" letterSpacing="0.1em">
        <text x="26" y="72" textAnchor="middle">
          BROWSER
        </text>
        <text x="100" y="72" textAnchor="middle">
          CORS
        </text>
        <text x="174" y="72" textAnchor="middle">
          OLLAMA
        </text>
      </g>
    </svg>
  );
}

const MODES = [
  {
    name: 'Bridge',
    tag: 'Default',
    diagram: <BridgeDiagram />,
    body: 'Requests go through this app’s own server, which forwards them to an Ollama URL the browser never sees. No CORS to configure.',
    caveat: 'Capped by your host’s function timeout.',
  },
  {
    name: 'Direct',
    tag: 'No time limit',
    diagram: <DirectDiagram />,
    body: 'The browser talks to Ollama itself. Nothing sits in the middle, so a long generation can run as long as it needs.',
    caveat: 'Requires your origin in OLLAMA_ORIGINS.',
  },
];

export function ModeCards() {
  return (
    <section className="relative px-6 py-20 sm:px-10 sm:py-28">
      <div className="hw-rule mb-10 sm:mb-14" />
      <div className="mb-12 max-w-2xl">
        <p className="type-eyebrow mb-4 text-content">Two ways in</p>
        <h2 className="type-display text-[clamp(1.9rem,5.2vw,3.5rem)] text-content">
          Pick how the browser reaches your models
        </h2>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {MODES.map((m) => (
          <article
            key={m.name}
            className="flex flex-col gap-6 border-2 border-content/25 p-6 transition-colors hover:border-content/60 sm:p-8"
          >
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="type-display text-[1.75rem] text-content">{m.name}</h3>
              <span className="type-label shrink-0 text-acid">{m.tag}</span>
            </div>

            <div className="border-y-2 border-content/15 py-5">{m.diagram}</div>

            <div>
              <p className="text-[0.975rem] leading-relaxed text-content-muted">{m.body}</p>
              <p className="mt-3 font-mono text-[0.72rem] uppercase tracking-[0.1em] text-content-subtle">
                {m.caveat}
              </p>
            </div>
          </article>
        ))}
      </div>

      <p className="mt-6 font-mono text-[0.75rem] leading-6 text-content-muted">
        Switchable any time from Settings &rarr; Connection.
      </p>
    </section>
  );
}
