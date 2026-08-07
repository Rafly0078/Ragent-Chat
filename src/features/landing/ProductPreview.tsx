import { ArrowUp, Paperclip, Sparkles } from 'lucide-react';

/** Static product proof used on landing; mirrors real chat surfaces, not a dashboard mock. */
export function ProductPreview() {
  return (
    <div className="relative mx-auto w-full max-w-[660px]">
      <div className="absolute -inset-5 rounded-[2rem] border border-border/10" aria-hidden />
      <div className="relative overflow-hidden rounded-2xl border border-border/20 bg-surface-raised shadow-float">
        <div className="border-border/12 flex items-center justify-between border-b px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-fg">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <span className="type-label truncate text-content">Local workspace</span>
          </div>
          <span className="flex items-center gap-2 font-mono text-[0.65rem] text-content-subtle">
            <span className="status-dot status-ok" /> Connected
          </span>
        </div>

        <div className="space-y-5 p-4 sm:space-y-6 sm:p-7">
          <div className="flex items-start gap-3">
            <span className="border-border/18 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-surface text-content-muted">
              01
            </span>
            <div className="min-w-0">
              <p className="type-label text-content-subtle">You</p>
              <p className="mt-1.5 text-sm leading-6 text-content">
                Turn this research into a clear one-page brief for my team.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 border-l-2 border-accent/55 pl-3 sm:pl-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-fg">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="type-label text-accent">Ragent</p>
                <span className="badge">qwen2.5-coder</span>
              </div>
              <div className="mt-2 space-y-2 text-sm leading-6 text-content-muted">
                <p>
                  Here is a tighter brief with the decision, evidence, and next action up front.
                </p>
                <div className="space-y-1.5 border-l border-border/20 pl-3 text-content">
                  <p className="font-medium">Decision</p>
                  <p className="text-content-muted">
                    Keep the workflow local; move only public sources through search.
                  </p>
                </div>
              </div>
              <p className="mt-3 font-mono text-[0.65rem] text-content-subtle">
                streamed 2.8s / 1,240 tokens
              </p>
            </div>
          </div>

          <div className="border-border/18 flex items-center gap-2 rounded-xl border bg-surface px-2.5 py-2">
            <Paperclip className="h-4 w-4 text-content-subtle" />
            <span className="flex-1 text-sm text-content-subtle">
              Ask your local models anything
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-fg">
              <ArrowUp className="h-4 w-4" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
