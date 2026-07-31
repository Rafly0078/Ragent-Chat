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
          className="popover absolute bottom-4 left-1/2 z-10 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full transition-colors duration-fast hover:text-accent"
          aria-label="Scroll to bottom"
        >
          <ArrowDown className="h-5 w-5" />
        </m.button>
      )}
    </AnimatePresence>
  );
}
