'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** `useLayoutEffect` warns during SSR; fall back to `useEffect` on the server. */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Auto-scroll behaviour for chat: sticks to the bottom while the user is near
 * the bottom, but stops following if they scroll up to read history. Exposes a
 * `scrollToBottom` action and an `atBottom` flag for the scroll-to-bottom FAB.
 */
export function useAutoScroll<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const stick = useRef(true);

  const threshold = 120;

  const handleScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distance < threshold;
    stick.current = near;
    setAtBottom((prev) => (prev === near ? prev : near));
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    stick.current = true;
    setAtBottom((prev) => (prev ? prev : true));
  }, []);

  // Follow new content only when the user is already pinned to the bottom.
  // Layout effect, not a passive one: the scroll write has to land in the same
  // frame as the paint, or every streamed token paints once at the stale offset
  // and then snaps down — visible jitter at the bottom of a streaming message.
  useIsomorphicLayoutEffect(() => {
    if (stick.current) {
      const el = ref.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [dep]);

  // Content that grows without changing `dep` — an image finishing load, the
  // lazy markdown chunk swapping in, a Mermaid SVG replacing its placeholder —
  // used to silently detach the view from the bottom.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    // Observe the content wrapper: the scroll container itself doesn't change
    // size as messages are added, only its child does.
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, []);

  return { ref, atBottom, scrollToBottom, handleScroll };
}
