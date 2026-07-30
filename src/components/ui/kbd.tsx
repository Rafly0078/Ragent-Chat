'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Keyboard-shortcut chip. Mono caps on a recessed well, matching `.badge`.
 *
 * `mod` renders the platform's modifier key: a real ⌘ on Apple hardware, "Ctrl"
 * elsewhere. It resolves after mount rather than during render because the
 * server has no way to know which one to print, and guessing produces a
 * hydration mismatch on half of all visitors. "Ctrl" is the pre-mount value
 * because it is also the wider string, so the chip does not resize on hydrate.
 */
export function Kbd({ children, mod, className }: { children?: string; mod?: boolean; className?: string }) {
  const [apple, setApple] = useState(false);

  useEffect(() => {
    setApple(/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent));
  }, []);

  return (
    <kbd
      className={cn(
        'inline-flex h-5 select-none items-center gap-1 rounded-[3px] border border-border/40 bg-border/10 px-1.5',
        'font-mono text-[0.62rem] uppercase leading-none tracking-[0.1em] text-content-subtle',
        className,
      )}
    >
      {mod && (apple ? '⌘' : 'Ctrl')}
      {children}
    </kbd>
  );
}
