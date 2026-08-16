'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Kbd } from '@/components/ui/kbd';

/**
 * The status rail's keyboard hint, and the shortcut it advertises.
 *
 * Client-rendered rather than server-rendered on purpose: the hint is a promise,
 * and a visitor with JS disabled would read one that nothing can keep. It
 * appears at the same moment the listener that honours it does.
 *
 * Hidden below `sm` by the caller — a keyboard hint on a device with no keyboard
 * is decoration pretending to be help.
 */
export function OpenChatShortcut() {
  const router = useRouter();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      // Only when nothing on the page has already claimed the key. Tabbing to
      // the button and pressing Enter is the button's Enter, and honouring both
      // pushes /chat twice.
      const focused = document.activeElement;
      if (focused && focused !== document.body && focused !== document.documentElement) return;
      event.preventDefault();
      router.push('/chat');
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [router]);

  return (
    <span className="flex flex-none items-center gap-2">
      <Kbd>enter</Kbd>
      open chat
    </span>
  );
}
