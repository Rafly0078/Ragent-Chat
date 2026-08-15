'use client';

import { LazyMotion, MotionConfig } from 'framer-motion';
import { ThemeManager } from './theme-manager';
import { ToastProvider } from '@/components/ui/toast';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { AuthGate } from '@/features/auth/AuthGate';
import { useChatSync } from '@/features/auth/use-chat-sync';

/**
 * Mounted app-wide rather than inside the home page: navigating to /settings
 * unmounted the page and with it the sync hook, so any change made in the
 * preceding debounce window was never written remotely — and returning to /
 * re-hydrated from the stale remote copy, losing it locally too. Settings can
 * mutate the store directly (chat import), which made this reproducible.
 */
function ChatSync() {
  useChatSync();
  return null;
}

/** Resolved on mount instead of at module scope — see the note on `features`. */
const loadDomAnimation = () => import('framer-motion').then((m) => m.domAnimation);

/**
 * Client providers. LazyMotion loads only the animation features we use,
 * shrinking the Framer Motion runtime for a better mobile bundle.
 *
 * `features` is a loader, not the imported `domAnimation` object: passing the
 * object statically defeats the point — it puts the feature bundle in the root
 * chunk of every route, including the landing page, which animates purely in
 * CSS. The async form is what actually defers it.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={loadDomAnimation} strict>
      <MotionConfig reducedMotion="user">
        <ThemeManager>
          <AuthProvider>
            <ToastProvider>
              <ChatSync />
              <AuthGate>{children}</AuthGate>
            </ToastProvider>
          </AuthProvider>
        </ThemeManager>
      </MotionConfig>
    </LazyMotion>
  );
}
