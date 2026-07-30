/**
 * Generative hero mark.
 *
 * The reference pairs its blue field with a classical engraving — radial
 * line-work exploding out of a central figure. That asset is Nous's, so this
 * borrows the *technique* rather than the image: a deterministic burst of rays
 * and concentric arcs, drawn as hairline strokes in the foreground colour.
 *
 * Deterministic on purpose. A seeded LCG (never Math.random) means the server
 * and client render identical geometry, so there is no hydration mismatch.
 */

const RAYS = 168;
const ARCS = 7;

/** Mulberry-style LCG — stable across environments, unlike Math.random. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

interface Ray {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
}

function buildRays(): Ray[] {
  const rnd = seeded(20260730);
  const cx = 250;
  const cy = 250;
  const out: Ray[] = [];
  for (let i = 0; i < RAYS; i++) {
    const a = (i / RAYS) * Math.PI * 2 + rnd() * 0.014;
    // Inner radius wobbles so the core reads as a torn edge, not a clean circle.
    const inner = 96 + rnd() * 26;
    // Long/short alternation gives the burst its engraved rhythm.
    const reach = i % 3 === 0 ? 236 : i % 3 === 1 ? 186 : 148;
    const outer = reach + rnd() * 24;
    out.push({
      x1: cx + Math.cos(a) * inner,
      y1: cy + Math.sin(a) * inner,
      x2: cx + Math.cos(a) * outer,
      y2: cy + Math.sin(a) * outer,
      w: i % 6 === 0 ? 1.1 : 0.55,
    });
  }
  return out;
}

const rays = buildRays();

export function HeroArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 500 500"
      className={className}
      role="img"
      aria-label="Abstract radial burst"
      // Strokes are hairlines; letting them scale keeps the engraved feel.
      vectorEffect="non-scaling-stroke"
    >
      <g stroke="currentColor" fill="none" strokeLinecap="round">
        {/* Concentric arcs, thinning outward. */}
        {Array.from({ length: ARCS }, (_, i) => (
          <circle
            key={`arc-${i}`}
            cx={250}
            cy={250}
            r={30 + i * 11}
            strokeWidth={i === 0 ? 1.4 : 0.5}
            opacity={0.85 - i * 0.09}
          />
        ))}

        {/* The burst. */}
        <g opacity={0.9}>
          {rays.map((r, i) => (
            <line
              key={`ray-${i}`}
              x1={r.x1}
              y1={r.y1}
              x2={r.x2}
              y2={r.y2}
              strokeWidth={r.w}
            />
          ))}
        </g>

        {/* Core: a solid disc so the centre holds weight against the rays. */}
        <circle cx={250} cy={250} r={22} fill="currentColor" stroke="none" opacity={0.92} />
      </g>
    </svg>
  );
}
