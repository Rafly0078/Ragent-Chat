'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Play,
  RotateCcw,
  Square,
  Wand2,
  XCircle,
} from 'lucide-react';
import type { WebSource } from '@/lib/sandbox/types';
import { composeDocument } from '@/lib/sandbox/compose';
import { buildBootstrap } from '@/lib/sandbox/bootstrap';
import { useSelfHeal } from './use-self-heal';
import { useSettings } from '@/lib/store/settings-store';
import { cn } from '@/lib/utils/cn';

interface Props {
  conversationId: string;
  /** Runnable web code extracted from the assistant message. */
  source: WebSource;
  /** True while the parent message is still streaming (defer running). */
  streaming?: boolean;
}

/**
 * A live sandbox for an assistant message's web code. Renders the code in a
 * locked-down iframe and offers an "Audit & fix" action that runs the
 * self-heal loop (run → collect errors → let the model fix → re-run). When the
 * auto-heal setting is on, the loop kicks off automatically once the message
 * finishes streaming.
 */
export function SandboxPanel({ conversationId, source, streaming }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [open, setOpen] = useState(true);
  const autoHeal = useSettings((s) => s.sandboxAutoHeal);
  const { state, run, stop, reset } = useSelfHeal(conversationId, source);
  const autoStarted = useRef(false);

  const busy = state.phase === 'running' || state.phase === 'healing';
  const finished = state.phase === 'done' || state.phase === 'stopped' || state.phase === 'error';

  // Show a plain preview until the loop takes over the iframe. Once a run
  // starts, runSandbox drives srcdoc; before that, render the initial code so
  // the user sees something immediately. `error`/`stopped` are excluded too —
  // repainting the *original* code there threw away whatever the last iteration
  // rendered, exactly when the user needs to see it.
  useEffect(() => {
    if (streaming || busy || finished) return;
    const el = iframeRef.current;
    if (!el) return;
    el.setAttribute('sandbox', 'allow-scripts');
    el.srcdoc = composeDocument(source, buildBootstrap('preview'));
  }, [source, streaming, busy, finished]);

  // Auto-run once when enabled and streaming has finished.
  useEffect(() => {
    if (streaming || !autoHeal || autoStarted.current) return;
    autoStarted.current = true;
    void run(iframeRef.current);
  }, [streaming, autoHeal, run]);

  const errorIssues = state.report?.issues.filter(
    (i) => i.kind === 'error' || i.kind === 'console-error',
  );
  const warnIssues = state.report?.issues.filter((i) => i.kind === 'console-warn');

  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-subtle">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent">
            <Play className="h-3.5 w-3.5" />
          </span>
          <span className="text-sm font-semibold text-content">Sandbox</span>
          <StatusBadge state={state} streaming={streaming} />
          <ChevronDown
            className={cn(
              'ml-auto h-4 w-4 shrink-0 text-content-subtle transition-transform',
              !open && '-rotate-90',
            )}
          />
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {busy ? (
            <button
              onClick={stop}
              className="btn-ghost flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium"
            >
              <Square className="h-3.5 w-3.5" /> Hentikan
            </button>
          ) : (
            <>
              {finished && (
                <button
                  onClick={() => {
                    // Actually re-run: `reset` alone only cleared the report and
                    // repainted the original code, so the control labelled
                    // "Jalankan ulang" never ran anything.
                    reset();
                    autoStarted.current = false;
                    void run(iframeRef.current);
                  }}
                  className="btn-ghost flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium"
                  aria-label="Jalankan ulang"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Ulang
                </button>
              )}
              <button
                onClick={() => void run(iframeRef.current)}
                disabled={streaming}
                className="btn-primary flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium disabled:opacity-40"
              >
                <Wand2 className="h-3.5 w-3.5" /> Audit &amp; perbaiki
              </button>
            </>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <m.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            {/* Preview */}
            <iframe
              ref={iframeRef}
              sandbox="allow-scripts"
              title="Sandbox preview"
              className="h-[360px] w-full border-0 bg-white"
            />

            {/* Issue report */}
            {state.report && (
              <div className="border-t border-border px-3 py-2.5 text-xs">
                {errorIssues && errorIssues.length > 0 && (
                  <IssueGroup
                    tone="error"
                    icon={<XCircle className="h-3.5 w-3.5" />}
                    title={`${errorIssues.length} error`}
                    issues={errorIssues.map((i) => i.message)}
                  />
                )}
                {state.report.blank && (!errorIssues || errorIssues.length === 0) && (
                  <p className="flex items-center gap-1.5 text-warning">
                    <AlertTriangle className="h-3.5 w-3.5" /> Halaman render kosong.
                  </p>
                )}
                {warnIssues && warnIssues.length > 0 && (
                  <IssueGroup
                    tone="warn"
                    icon={<AlertTriangle className="h-3.5 w-3.5" />}
                    title={`${warnIssues.length} peringatan`}
                    issues={warnIssues.map((i) => i.message)}
                  />
                )}
                {state.clean && (
                  <p className="flex items-center gap-1.5 text-success">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Kode berjalan bersih tanpa error.
                  </p>
                )}
              </div>
            )}

            {state.error && (
              <div className="border-t border-border px-3 py-2.5 text-xs text-error">
                {state.error}
              </div>
            )}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusBadge({
  state,
  streaming,
}: {
  state: ReturnType<typeof useSelfHeal>['state'];
  streaming?: boolean;
}) {
  if (streaming) return null;
  /* One shape for every run state: the shared `.badge badge-outline` chrome plus
     `.status-dot`, whose colour comes from `--tone`. The washes these used to
     carry (`bg-accent/15`, `bg-amber-500/15`) measure ~1.1:1 against the field,
     so the fill was doing nothing and the amber pair was off-system besides.
     Every state still pairs its colour with an icon or a dot, so none of them
     depends on colour alone. */
  const base = 'badge badge-outline';

  if (state.phase === 'running') {
    return (
      <span className={cn(base, 'text-accent')}>
        <span className="status-dot status-running" aria-hidden /> Menjalankan… {state.iteration}/
        {state.maxIterations}
      </span>
    );
  }
  if (state.phase === 'healing') {
    return (
      <span className={cn(base, 'text-accent')}>
        <span className="status-dot status-running" aria-hidden /> Memperbaiki… {state.iteration}/
        {state.maxIterations}
      </span>
    );
  }
  if (state.phase === 'done') {
    return state.clean ? (
      <span className={cn(base, 'text-success')}>
        <CheckCircle2 className="h-3 w-3" /> Bersih
      </span>
    ) : (
      <span className={cn(base, 'text-warning')}>
        <AlertTriangle className="h-3 w-3" /> Masih ada masalah
      </span>
    );
  }
  if (state.phase === 'stopped') {
    return (
      <span className={cn(base, 'text-content-muted')}>
        <Square className="h-3 w-3" /> Dihentikan
      </span>
    );
  }
  if (state.phase === 'error') {
    return (
      <span className={cn(base, 'text-error')}>
        <XCircle className="h-3 w-3" /> Gagal
      </span>
    );
  }
  return null;
}

function IssueGroup({
  tone,
  icon,
  title,
  issues,
}: {
  tone: 'error' | 'warn';
  icon: React.ReactNode;
  title: string;
  issues: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? issues : issues.slice(0, 3);
  return (
    <div className="mb-1.5 last:mb-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          'flex items-center gap-1.5 font-medium',
          tone === 'error' ? 'text-error' : 'text-warning',
        )}
      >
        {icon} {title}
        {issues.length > 3 && (
          <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
        )}
      </button>
      <ul className="mt-1 space-y-1 pl-5">
        {shown.map((msg, i) => (
          <li key={i} className="whitespace-pre-wrap break-words font-mono text-content-muted">
            {msg}
          </li>
        ))}
        {!expanded && issues.length > 3 && (
          <li className="text-content-subtle">+{issues.length - 3} lainnya…</li>
        )}
      </ul>
    </div>
  );
}
