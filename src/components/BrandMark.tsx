/**
 * The brand mark: a room with a light in it — the same figure the landing hero
 * draws in 3D and the chat empty state repeats. Vector, so it scales, inherits
 * `currentColor`, and follows the accent preset; the two noun-project PNGs it
 * replaced did none of those things.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect
        x="5.5"
        y="5.5"
        width="21"
        height="21"
        rx="4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        opacity="0.55"
      />
      <circle
        cx="16"
        cy="16"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity="0.3"
      />
      <circle cx="16" cy="16" r="3.6" fill="currentColor" />
    </svg>
  );
}
