'use client';

import { useEffect, useRef } from 'react';

/**
 * The hero's signature: a room with a light in it.
 *
 * A wireframe cube (your machine) rotating slowly around a warm core (the
 * model). Every edge is shaded by its 3D distance to that core, so the light
 * genuinely falls off across the geometry rather than being painted on, and the
 * satellite nodes orbit strictly inside the box — nothing ever crosses the
 * boundary. That is the whole argument of the product, drawn.
 *
 * Canvas 2D with hand-rolled perspective projection rather than three.js: the
 * scene is twelve edges and seven points, which is not worth 600 kB and a WebGL
 * context to an app whose entire pitch is that it stays small and local.
 *
 * Cost control: rAF pauses when the canvas scrolls out of view, DPR is capped,
 * segment count drops on narrow screens, and `prefers-reduced-motion` renders a
 * single static frame and never starts a loop.
 */

type V3 = [number, number, number];

/** The room: a unit cube. */
const CORNERS: V3[] = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
];

const EDGES: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

/** The models: deterministic orbits, all with radius < 1 so they stay inside. */
const NODES = [
  { r: 0.42, tilt: 0.2, speed: 0.55, phase: 0 },
  { r: 0.58, tilt: -0.7, speed: -0.38, phase: 1.1 },
  { r: 0.7, tilt: 1.25, speed: 0.29, phase: 2.4 },
  { r: 0.33, tilt: -1.4, speed: 0.72, phase: 3.6 },
  { r: 0.63, tilt: 0.85, speed: -0.5, phase: 4.2 },
  { r: 0.5, tilt: 2.1, speed: 0.41, phase: 5.5 },
  { r: 0.75, tilt: -0.3, speed: -0.24, phase: 0.7 },
];

function rotate([x, y, z]: V3, rx: number, ry: number): V3 {
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const x1 = x * cy + z * sy;
  const z1 = z * cy - x * sy;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  return [x1, y * cx - z1 * sx, z1 * cx + y * sx];
}

/** Perspective divide. `FOV` is the camera distance in world units. */
const FOV = 4.2;
function project(p: V3, cw: number, ch: number, radius: number) {
  const k = FOV / (FOV + p[2]);
  return { x: cw / 2 + p[0] * radius * k, y: ch / 2 + p[1] * radius * k, k };
}

/** Reads an `r g b` custom property so the canvas follows the accent preset. */
function readRgb(el: Element, name: string, fallback: [number, number, number]) {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  const parts = raw.split(/[\s,]+/).map(Number);
  return parts.length === 3 && parts.every((n) => Number.isFinite(n))
    ? (parts as [number, number, number])
    : fallback;
}

function mix(a: [number, number, number], b: [number, number, number], t: number, alpha: number) {
  const c = (i: number) => Math.round(a[i]! + (b[i]! - a[i]!) * t);
  return `rgba(${c(0)}, ${c(1)}, ${c(2)}, ${alpha.toFixed(3)})`;
}

export function HeroCore({ className }: { className?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = wrap.current;
    const cv = canvas.current;
    const ctx = cv?.getContext('2d');
    if (!host || !cv || !ctx) return;

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lamp = readRgb(host, '--lamp', [255, 182, 92]);
    const ember = readRgb(host, '--ember', [255, 122, 69]);
    const cool = readRgb(host, '--content-subtle', [113, 123, 150]);

    let cw = 0;
    let ch = 0;
    let dpr = 1;
    let segments = 16;

    const resize = () => {
      const rect = host.getBoundingClientRect();
      cw = Math.max(1, Math.round(rect.width));
      ch = Math.max(1, Math.round(rect.height));
      // Capped: past 2x the extra pixels are invisible and the fill cost is real.
      dpr = Math.min(window.devicePixelRatio || 1, cw < 520 ? 1.5 : 2);
      segments = cw < 520 ? 9 : 16;
      cv.width = Math.round(cw * dpr);
      cv.height = Math.round(ch * dpr);
      cv.style.width = `${cw}px`;
      cv.style.height = `${ch}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    // Pointer parallax: the room turns a little toward the cursor. `targetX/Y`
    // is where it wants to be, `rx/ry` chases it, so the motion has weight.
    let rx = -0.32;
    let ry = 0.6;
    let targetX = -0.32;
    let targetY = 0.6;
    let spin = 0;

    const onPointer = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      const nx = (e.clientX - (rect.left + rect.width / 2)) / (rect.width || 1);
      const ny = (e.clientY - (rect.top + rect.height / 2)) / (rect.height || 1);
      targetY = 0.6 + Math.max(-1, Math.min(1, nx)) * 0.5;
      targetX = -0.32 + Math.max(-1, Math.min(1, ny)) * 0.32;
    };

    const draw = (t: number) => {
      const radius = Math.min(cw, ch) * 0.31;
      ctx.clearRect(0, 0, cw, ch);

      // The core glow, drawn first so every edge sits on top of its own light.
      const centre = project([0, 0, 0], cw, ch, radius);
      const halo = ctx.createRadialGradient(
        centre.x,
        centre.y,
        0,
        centre.x,
        centre.y,
        radius * 1.5,
      );
      halo.addColorStop(0, mix(lamp, ember, 0.35, 0.5));
      halo.addColorStop(0.35, mix(lamp, ember, 0.6, 0.12));
      halo.addColorStop(1, mix(lamp, ember, 1, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, radius * 1.5, 0, Math.PI * 2);
      ctx.fill();

      const spun = CORNERS.map((c) => rotate(c, rx, ry + spin));

      // Edges, segment by segment. Intensity falls off with distance from the
      // core (which is why the near corners read warm and the far ones don't)
      // and again with depth, so the far face recedes.
      ctx.lineCap = 'round';
      for (const [a, b] of EDGES) {
        const pa = spun[a]!;
        const pb = spun[b]!;
        for (let s = 0; s < segments; s++) {
          const t0 = s / segments;
          const t1 = (s + 1) / segments;
          const mid: V3 = [
            pa[0] + (pb[0] - pa[0]) * ((t0 + t1) / 2),
            pa[1] + (pb[1] - pa[1]) * ((t0 + t1) / 2),
            pa[2] + (pb[2] - pa[2]) * ((t0 + t1) / 2),
          ];
          const dist = Math.hypot(mid[0], mid[1], mid[2]);
          // 1 at the core, 0 at the far corner of the cube (sqrt(3)).
          const fall = Math.max(0, 1 - (dist - 0.9) / 0.84);
          const depth = (1 - mid[2] / 1.9) / 2;
          ctx.strokeStyle = mix(cool, lamp, fall * fall, 0.2 + fall * 0.58 + depth * 0.2);
          ctx.lineWidth = 0.8 + fall * 1.7 * depth;
          const s0 = project(
            [
              pa[0] + (pb[0] - pa[0]) * t0,
              pa[1] + (pb[1] - pa[1]) * t0,
              pa[2] + (pb[2] - pa[2]) * t0,
            ],
            cw,
            ch,
            radius,
          );
          const s1 = project(
            [
              pa[0] + (pb[0] - pa[0]) * t1,
              pa[1] + (pb[1] - pa[1]) * t1,
              pa[2] + (pb[2] - pa[2]) * t1,
            ],
            cw,
            ch,
            radius,
          );
          ctx.beginPath();
          ctx.moveTo(s0.x, s0.y);
          ctx.lineTo(s1.x, s1.y);
          ctx.stroke();
        }
      }

      // The models. Painted back-to-front so a near node overlaps a far one.
      const orbit = NODES.map((n) => {
        const a = n.phase + t * 0.00042 * n.speed * 60;
        const local: V3 = [
          Math.cos(a) * n.r,
          Math.sin(a) * n.r * Math.sin(n.tilt),
          Math.sin(a) * n.r * Math.cos(n.tilt),
        ];
        return rotate(local, rx, ry + spin);
      }).sort((p, q) => q[2] - p[2]);

      for (const p of orbit) {
        const pr = project(p, cw, ch, radius);
        const near = (1 - p[2] / 1.4) / 2;
        ctx.fillStyle = mix(lamp, ember, 0.3, 0.35 + near * 0.6);
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, (1.4 + near * 2.6) * pr.k, 0, Math.PI * 2);
        ctx.fill();
      }

      // The core itself, last and brightest.
      ctx.fillStyle = mix(lamp, [255, 255, 255], 0.28, 0.98);
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, radius * 0.05, 0, Math.PI * 2);
      ctx.fill();
    };

    let frame = 0;
    let running = false;
    let last = 0;

    const tick = (now: number) => {
      const dt = last ? Math.min(now - last, 48) : 16;
      last = now;
      // Frame-rate independent, so a 120 Hz display does not spin twice as fast.
      spin += dt * 0.00009;
      rx += (targetX - rx) * 0.06;
      ry += (targetY - ry) * 0.06;
      draw(now);
      frame = requestAnimationFrame(tick);
    };

    const start = () => {
      if (running || still) return;
      running = true;
      last = 0;
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(frame);
    };

    const ro = new ResizeObserver(() => {
      resize();
      if (!running) draw(performance.now());
    });
    ro.observe(host);

    // Off-screen costs nothing: the loop is only alive while the mark is visible.
    const io = new IntersectionObserver(([entry]) => (entry?.isIntersecting ? start() : stop()), {
      threshold: 0,
    });
    io.observe(host);

    resize();
    draw(performance.now());
    if (!still) window.addEventListener('pointermove', onPointer, { passive: true });

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('pointermove', onPointer);
    };
  }, []);

  return (
    <div ref={wrap} className={className}>
      <canvas ref={canvas} aria-hidden className="block h-full w-full" />
    </div>
  );
}
