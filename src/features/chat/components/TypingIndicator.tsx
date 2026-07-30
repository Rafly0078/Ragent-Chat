'use client';

/**
 * Streaming placeholder shown before the first token lands.
 *
 * Deliberately not a spinner and not three bouncing dots: a determinate-looking
 * bar sweeping in the accent colour matches the flat, ruled language of the rest
 * of the app, and it animates `transform` only, so it costs nothing. Under
 * `prefers-reduced-motion` the global rule in globals.css freezes it and the bar
 * simply sits there as a static accent rule.
 */
export function TypingIndicator() {
  return (
    <div className="flex items-center gap-3" role="status" aria-label="Assistant is responding">
      <span className="relative block h-[3px] w-28 overflow-hidden rounded-full bg-border/15">
        <span className="animate-scan absolute inset-y-0 left-0 w-1/3 rounded-full bg-accent" />
      </span>
      <span className="type-label text-content-subtle">Thinking</span>
    </div>
  );
}
