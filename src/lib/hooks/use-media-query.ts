'use client';

import { useEffect, useState } from 'react';

/**
 * Reactive media query hook.
 *
 * Deliberately starts at `false` — including on the client's first render — so
 * the hydrated markup matches what the server produced. Reading
 * `window.matchMedia` in the initial state would fix the one-frame layout flash
 * on mobile but introduce a hydration mismatch instead, which is worse.
 * Components that must be correct on the very first paint should gate on
 * `useHydrated()` and render a neutral placeholder until then; code that only
 * needs the value in an effect (e.g. theme resolution) should read
 * `window.matchMedia` directly rather than going through this hook.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);

  return matches;
}

export const useIsMobile = () => useMediaQuery('(max-width: 768px)');
export const usePrefersReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');
