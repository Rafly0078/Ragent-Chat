'use client';

import { cn } from '@/lib/utils/cn';

/**
 * Toggle switch.
 *
 * The "on" track is `--accent`, not `--accent-solid`: on the #0000f2 field the
 * accent is acid (8.32:1) and the fill tier is paper, and a paper track under a
 * paper knob is a switch with no knob. Written as an arbitrary value rather than
 * `bg-accent` because that utility is centrally redirected to the fill tier —
 * see the ACCENT SPLIT note in globals.css.
 *
 * The "off" track carries a full-opacity rule. A translucent track measures
 * ~1.2:1 against this field, so without the rule the off state would read as
 * empty space rather than as a control.
 *
 * The visual track is 24x44; the button is 44x44 so the touch target clears the
 * platform minimum without making the switch look oversized.
 */
export function Switch({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  id?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="focus-ring relative inline-flex h-11 w-11 shrink-0 items-center justify-center"
    >
      <span
        aria-hidden
        className={cn(
          'relative flex h-6 w-11 items-center rounded-full border-2 transition-colors duration-fast ease-out',
          checked
            ? 'border-[rgb(var(--accent))] bg-[rgb(var(--accent))]'
            : 'border-border/15 bg-border/15',
        )}
      >
        <span
          className={cn(
            'block h-3.5 w-3.5 rounded-full transition-transform duration-fast ease-out',
            checked
              ? 'translate-x-[1.4rem] bg-[rgb(var(--accent-fg))]'
              : 'translate-x-[0.2rem] bg-content',
          )}
        />
      </span>
    </button>
  );
}
