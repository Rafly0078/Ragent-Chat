/**
 * How the browser reaches your models. Two real options, so two cards — a third
 * would be padding — and each gets its own diagram rather than a shared icon.
 * The install block lands at the end of the section because that is the step you
 * take right after choosing.
 */

import { Reveal } from './Reveal';
import { InstallBlock } from './InstallBlock';

function BridgeDiagram() {
  return (
    <svg viewBox="0 0 200 90" className="h-auto w-full text-content-muted" aria-hidden>
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
    <svg viewBox="0 0 200 90" className="h-auto w-full text-content-muted" aria-hidden>
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
    <section id="connect" className="relative px-6 pb-16 pt-24 sm:px-10 sm:pb-20 sm:pt-32">
      <div className="rule-t mb-12 sm:mb-16" />

      <Reveal className="mb-12 max-w-2xl sm:mb-16">
        <p className="type-eyebrow">Two Ollama paths</p>
        <h2 className="type-display mt-5 text-[clamp(1.9rem,5vw,3.4rem)] text-content">
          Pick how the browser reaches local models
        </h2>
      </Reveal>

      <div className="grid gap-5 md:grid-cols-2">
        {MODES.map((m, i) => (
          <Reveal key={m.name} delay={i * 80}>
            <article className="card edge-lit lift group flex h-full flex-col gap-6 p-6 sm:p-8">
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="type-display text-[1.6rem] text-content">{m.name}</h3>
                <span className={m.tag === 'Default' ? 'badge badge-lit' : 'badge badge-outline'}>
                  {m.tag}
                </span>
              </div>

              <div className="well px-4 py-5">{m.diagram}</div>

              <div className="mt-auto">
                <p className="text-[0.95rem] leading-relaxed text-content-muted">{m.body}</p>
                <p className="mt-4 flex items-start gap-2 font-mono text-[0.72rem] uppercase leading-5 tracking-[0.08em] text-content-subtle">
                  <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent/70" />
                  {m.caveat}
                </p>
              </div>
            </article>
          </Reveal>
        ))}
      </div>

      <Reveal delay={120} className="mt-14 sm:mt-20">
        <InstallBlock />
      </Reveal>

      <p className="mt-8 font-mono text-[0.75rem] leading-6 text-content-subtle">
        Switchable any time from Settings &rarr; Connection.
      </p>
    </section>
  );
}
