import { cn } from '@/lib/utils/cn';

/**
 * Skeleton placeholder. Uses an opacity pulse only (GPU-cheap, compliant with
 * the "animate opacity/transform only" rule) — no shimmer gradient repaint.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-border/[0.06]', className)} />;
}

export function MessageSkeleton() {
  return (
    <div className="chat-container flex gap-4 py-6">
      {/* Matches the real avatar in MessageBubble: h-8 w-8, rounded-md. A circle
          here made every message visibly change shape the moment it loaded. */}
      <Skeleton className="h-8 w-8 shrink-0 rounded-md" />
      <div className="flex-1 space-y-3 py-1">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-5/6" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
    </div>
  );
}
