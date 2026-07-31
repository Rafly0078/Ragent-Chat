'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * Scroll reveal. One primitive, so every section on the landing page enters with
 * the same rhythm instead of each one inventing its own.
 *
 * Deliberately not framer-motion's `whileInView`. That renders `opacity: 0` into
 * the server HTML, which means the entire page below the hero is invisible until
 * hydration finishes — and stays invisible forever if it never does. Here the
 * server renders the content plainly and JavaScript is what hides it, so the
 * no-JS and slow-hydration cases both degrade to "visible" instead of "blank".
 *
 * Anything already on screen when the observer boots is left alone rather than
 * hidden and re-shown: an element you are already looking at has nothing to
 * reveal, and animating it would just be a flash.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  /** Milliseconds. Use with an index to stagger siblings: `delay={i * 55}`. */
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'off' | 'pending' | 'in'>('off');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return;

    setState('pending');
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setState('in');
        io.disconnect();
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      data-reveal={state === 'off' ? undefined : state}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
