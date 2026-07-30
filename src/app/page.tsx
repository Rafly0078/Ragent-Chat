import type { Metadata } from 'next';
import { LandingNav } from '@/features/landing/LandingNav';
import { Hero } from '@/features/landing/Hero';
import { FeatureList } from '@/features/landing/FeatureList';
import { ModeCards } from '@/features/landing/ModeCards';
import { LandingFooter } from '@/features/landing/LandingFooter';

export const metadata: Metadata = {
  title: 'Ragent — the models that never leave home',
};

/**
 * Landing page.
 *
 * `.hermes-canvas` is what makes this surface different from the rest of the
 * app: it rebinds every colour token to the electric-blue field and opens a
 * container-query context, which the fluid `--u` unit needs. The chat app keeps
 * its own dark/paper canvas — same type, same radii, same rules, different
 * ground. See globals.css.
 *
 * A server component: nothing here needs client state except the copy button in
 * the install block and the nav's stuck-state observer, which are client islands
 * of their own.
 *
 * `overflow-x-clip` rather than `overflow-x-hidden`: `hidden` on one axis forces
 * the other axis to `auto`, which turns this element into a scroll container —
 * and a `position: sticky` nav inside a scroll container that never scrolls is a
 * nav that never sticks. `clip` contains the same overflow without any of that.
 */
export default function LandingPage() {
  return (
    <main className="hermes-grain hermes-canvas relative min-h-[100dvh] w-full max-w-full overflow-x-clip">
      <div className="relative z-10 mx-auto w-full max-w-[1600px]">
        <LandingNav />
        <Hero />
        <FeatureList />
        <ModeCards />
        <LandingFooter />
      </div>
    </main>
  );
}
