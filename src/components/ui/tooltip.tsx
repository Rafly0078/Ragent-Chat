'use client';

import { cn } from '@/lib/utils/cn';

/**
 * Lightweight CSS tooltip — no JS positioning library, no runtime cost.
 * Wrap any element; the label appears on hover/focus.
 */
export function Tooltip({
  label,
  side = 'top',
  children,
  className,
}: {
  label: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: React.ReactNode;
  className?: string;
}) {
  const pos = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  }[side];

  return (
    <span className={cn('group/tt relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          // focus-visible (not focus-within) so the tooltip shows for keyboard
          // users but doesn't stay pinned open after a mouse click leaves the
          // button focused.
          'popover pointer-events-none absolute z-50 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs text-content opacity-0 shadow-raised transition-opacity duration-150 group-hover/tt:opacity-100 group-[:has(:focus-visible)]/tt:opacity-100',
          pos,
        )}
      >
        {label}
      </span>
    </span>
  );
}
