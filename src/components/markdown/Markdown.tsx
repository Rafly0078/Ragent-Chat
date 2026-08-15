'use client';

import { lazy, memo, Suspense, useEffect, useRef, useState } from 'react';

/**
 * Lazy markdown boundary. The heavy renderer (react-markdown, remark/rehype,
 * KaTeX, highlight.js + their CSS) is code-split and only fetched the first time
 * a message needs rich rendering — it never touches the initial bundle or FCP.
 *
 * While the chunk loads, the Suspense fallback shows the same text with matching
 * typography/whitespace, so first paint is instant and nothing shifts when the
 * renderer swaps in. Once resolved it stays mounted (no re-suspense on streaming
 * prop changes).
 */
const MarkdownRenderer = lazy(() => import('./MarkdownRenderer'));

function PlainFallback({ content }: { content: string }) {
  return <div className="prose-chat whitespace-pre-wrap break-words">{content}</div>;
}

/**
 * Gate rich rendering on visibility. `content-visibility: auto` skips layout and
 * paint for offscreen messages, but NOT JavaScript — without this, mounting a
 * long conversation runs react-markdown + highlight.js synchronously for every
 * message at once (dozens of blocks), which drops frames on load. Here each
 * message renders as plain text until it scrolls near the viewport, then
 * upgrades to the full renderer. The upgrade is one-way: once a message has been
 * seen it stays rich, so scrolling back and forth never re-parses or churns.
 *
 * Streaming messages skip the gate entirely — they're always on screen and must
 * render live.
 */
function useHasBeenVisible(streaming: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(streaming);

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    // No IntersectionObserver (old browsers / SSR edge) → render rich now.
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      // Start rendering a bit before the message enters view so the upgrade
      // isn't visible to the user as a swap.
      { rootMargin: '600px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  return { ref, visible };
}

/**
 * How often the rich renderer is allowed to re-parse a streaming message.
 *
 * The store already coalesces upstream tokens to one write per animation frame,
 * but that is still ~60 writes/sec, and each one produces a new `content`
 * string — which means the entire remark → mdast → rehype-katex →
 * rehype-highlight → hast → React pipeline ran again over the WHOLE
 * accumulated message, then reconciled the full element tree. A 4 KB answer
 * with two code fences is roughly 5-10 ms of that work on a desktop and 30-60 ms
 * on a mid-tier Android — 2-4x the 16.7 ms frame budget, growing linearly with
 * message length, so the end of a long answer was the jankiest part.
 *
 * ~100 ms caps it at ~10 parses/sec instead of 60. Text still visibly flows and
 * code blocks still format live; the work drops ~6x. The final render is exact
 * and unthrottled — see `useRenderContent`.
 */
const STREAM_PARSE_INTERVAL_MS = 100;

/**
 * Live content for the cheap plain-text path, time-sliced content for the
 * expensive one. Returns `content` verbatim the moment `streaming` goes false,
 * so the settled message is never a stale frame behind.
 */
function useRenderContent(content: string, streaming: boolean): string {
  const [shown, setShown] = useState(content);
  const latest = useRef(content);
  latest.current = content;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!streaming) {
      // Settled: drop the pending tick so it can't fire a pointless re-render
      // after we've already switched to returning `content` verbatim.
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      return;
    }
    // A tick is already pending — it will pick up `latest.current`.
    if (timer.current !== null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setShown(latest.current);
    }, STREAM_PARSE_INTERVAL_MS);
  }, [content, streaming]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  return streaming ? shown : content;
}

export const Markdown = memo(function Markdown({
  content,
  streaming,
}: {
  content: string;
  streaming?: boolean;
}) {
  const isStreaming = streaming === true;
  const { ref, visible } = useHasBeenVisible(isStreaming);
  // Plain text below gets the live string — it costs nothing to render and keeps
  // the caret moving at frame rate. Only the rich renderer is time-sliced.
  const parsed = useRenderContent(content, isStreaming);

  if (!visible) {
    return (
      <div ref={ref}>
        <PlainFallback content={content} />
      </div>
    );
  }

  return (
    <Suspense fallback={<PlainFallback content={content} />}>
      <MarkdownRenderer content={parsed} streaming={streaming} />
    </Suspense>
  );
});
