'use client';

import { useEffect, useRef, useState } from 'react';
import { m } from 'framer-motion';
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
import { composeDocument, extractWebSource } from '@/lib/sandbox/compose';
import { buildBootstrap } from '@/lib/sandbox/bootstrap';
import { useSelfHeal } from './use-self-heal';
import { useChatStore } from '@/lib/store/chat-store';
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
 * How recently the conversation must have been written to for a mounting panel to
 * count as "this code just streamed in". Generous, because the panel is imported
 * lazily: the first one in a session waits on a chunk fetch before it can mount.
 */
const JUST_STREAMED_MS = 10_000;

/**
 * True when this panel's code is the newest message in its conversation AND that
 * conversation was written to moments ago — i.e. a stream just ended, rather than
 * the panel having been mounted by a history load.
 *
 * Both halves are needed. `updatedAt` alone would fire for every panel in the
 * conversation at once, and being the last message alone is exactly the state of an
 * old conversation the user opened to read.
 */
function justStreamed(conversationId: string, source: WebSource): boolean {
  const convo = useChatStore.getState().conversations.find((c) => c.id === conversationId);
  if (!convo || Date.now() - convo.updatedAt > JUST_STREAMED_MS) return false;
  const last = convo.messages[convo.messages.length - 1];
  if (!last || last.role !== 'assistant') return false;
  const newest = extractWebSource(last.content);
  return (
    newest !== null &&
    newest.html === source.html &&
    newest.css === source.css &&
    newest.js === source.js
  );
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
  // Sampled once, at mount: this is a question about why the panel appeared, and
  // both halves of the answer keep moving as the conversation is written to.
  const [fresh] = useState(() => justStreamed(conversationId, source));

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

  // Auto-run once, and only for code that just streamed in. The `streaming` guard
  // cannot tell the difference on its own: MessageBubble extracts a source only
  // from a settled message, so the panel always mounts with `streaming` already
  // false. Opening a conversation with four old code messages therefore started
  // four audit loops at once — four sandbox runs and, for anything not clean, a
  // model call per iteration on history the user had only opened to read.
  useEffect(() => {
    if (!fresh || streaming || !autoHeal || autoStarted.current) return;
    autoStarted.current = true;
    void run(iframeRef.current);
  }, [fresh, streaming, autoHeal, run]);

  const errorIssues = state.report?.issues.filter(
    (i) => i.kind === 'error' || i.kind === 'console-error',
  );
  const warnIssues = state.report?.issues.filter((i) => i.kind === 'console-warn');

  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-border/15 bg-surface-raised shadow-subtle">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/15 px-3 py-2">
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
                    // "Run again" never ran anything.
                    reset();
                    autoStarted.current = false;
                    void run(iframeRef.current);
                  }}
                  className="btn-ghost flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium"
                  aria-label="Run again"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Ulang
                </button>
              )}
              <button
                onClick={() => void run(iframeRef.current)}
                disabled={streaming}
                className="btn-primary flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium disabled:opacity-40"
              >
                <Wand2 className="h-3.5 w-3.5" /> Audit &amp; fix
              </button>
            </>
          )}
        </div>
      </div>

      {/* The body collapses; it never unmounts. The iframe used to live inside an
          `{open && …}` branch, so the header toggle threw the frame away:
          re-expanding mounted a blank one and the paint effect above, whose deps had
          not changed, never repainted it — and collapsing mid-run discarded the
          browsing context runSandbox was driving, which its 8s timer then reported
          as "the page did not finish loading" and the heal loop spent a model call
          fixing code that had run fine. Collapsed by height rather than
          `display:none`/`visibility:hidden`: a frame that isn't rendered has no
          visible text, and the guest's own blank-render check would call a working
          page a white screen. */}
      <m.div
        inert={!open}
        initial={false}
        animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
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
          <div className="border-t border-border/15 px-3 py-2.5 text-xs">
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
                <CheckCircle2 className="h-3.5 w-3.5" /> Ran clean, no errors.
              </p>
            )}
          </div>
        )}

        {state.error && (
          <div className="border-t border-border/15 px-3 py-2.5 text-xs text-error">
            {state.error}
          </div>
        )}
      </m.div>
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
  const base = 'term-chip';

  if (state.phase === 'running') {
    return (
      <span className={cn(base, 'text-accent')}>
        <span className="term-run" aria-hidden /> Running… {state.iteration}/{state.maxIterations}
      </span>
    );
  }
  if (state.phase === 'healing') {
    return (
      <span className={cn(base, 'text-accent')}>
        <span className="term-run" aria-hidden /> Fixing… {state.iteration}/{state.maxIterations}
      </span>
    );
  }
  if (state.phase === 'done') {
    return state.clean ? (
      <span className={cn(base, 'text-success')}>
        <CheckCircle2 className="h-3 w-3" /> Clean
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
        <XCircle className="h-3 w-3" /> Failed
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
