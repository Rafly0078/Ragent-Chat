'use client';

import { AnimatePresence, m } from 'framer-motion';
import { ArrowDown } from 'lucide-react';

export function ScrollToBottomButton({
  visible,
  onClick,
}: {
  visible: boolean;
  onClick: () => void;
}) {
  return (
    <AnimatePresence>
      {visible && (
        <m.button
          initial={{ opacity: 0, y: 12, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 400, damping: 28 }}
          onClick={onClick}
          // The centering has to be a motion value rather than `-translate-x-1/2`:
          // framer-motion writes the whole `transform` inline — literally `none`
          // once y and scale settle back at their defaults — so the Tailwind class
          // was overridden and this sat half its own width right of centre for the
          // entire time it was on screen.
          style={{ x: '-50%' }}
          className="popover absolute bottom-4 left-1/2 z-10 flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-fast hover:text-accent"
          aria-label="Scroll to bottom"
        >
          <ArrowDown className="h-5 w-5" />
        </m.button>
      )}
    </AnimatePresence>
  );
}
