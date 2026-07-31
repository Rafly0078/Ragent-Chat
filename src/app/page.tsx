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
 * `.lamp-field` is what grounds this surface: it paints the night field and
 * opens a container-query context, which the fluid `--u` unit needs. The chat
 * app shares the same field via AmbientBackground — same type, same radii, same
 * light source, one canvas.
 *
 * `overflow-x-clip` rather than `overflow-x-hidden`: `hidden` on one axis forces
 * the other axis to `auto`, which turns this element into a scroll container —
 * and a `position: sticky` nav inside a scroll container that never scrolls is a
 * nav that never sticks. `clip` contains the same overflow without any of that.
 */
export default function LandingPage() {
  return (
    <main className="grain lamp-field relative min-h-[100dvh] w-full max-w-full overflow-x-clip">
      <div className="relative z-10 mx-auto w-full max-w-[1400px]">
        <LandingNav />
        <Hero />
        <FeatureList />
        <ModeCards />
        <LandingFooter />
      </div>
    </main>
  );
}
