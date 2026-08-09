'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import {
  AlertCircle,
  Check,
  Copy,
  Pencil,
  RefreshCw,
  Trash2,
  User,
  Sparkles,
  CornerDownRight,
  Globe,
  X,
  Brain,
  ChevronDown,
} from 'lucide-react';
import type { Message, ThinkingEffort } from '@/types';
import type { Source } from '@/lib/search/types';
import { Markdown } from '@/components/markdown/Markdown';
import { Tooltip } from '@/components/ui/tooltip';
import { SandboxPanel } from '@/features/sandbox/SandboxPanel';
import { extractWebSource } from '@/lib/sandbox/compose';
import { TypingIndicator } from './TypingIndicator';
import { attachmentPreview } from '@/lib/utils/files';
import { formatDuration, formatNumber } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

export interface MessageActions {
  onCopy: (text: string) => void;
  onEdit: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  onRegenerate: (id: string) => void;
  onContinue: (id: string) => void;
  onRetry: (id: string) => void;
}

interface Props {
  message: Message;
  isLast: boolean;
  generating: boolean;
  actions: MessageActions;
  conversationId: string;
}

/**
 * One response metric. Uses the shared `.badge` chrome — this was the fourth
 * hand-rolled pill in the app with its own radius, padding and type size.
 */
function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="badge text-content-subtle">
      <span className="tabular-nums text-content">{value}</span>
      {label}
    </span>
  );
}

export const MessageBubble = memo(function MessageBubble({
  message,
  isLast,
  generating,
  actions,
  conversationId,
}: Props) {
  const isUser = message.role === 'user';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const copy = () => {
    actions.onCopy(message.content);
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  const submitEdit = () => {
    setEditing(false);
    if (draft.trim() && draft !== message.content) actions.onEdit(message.id, draft);
  };

  const showActions = !message.streaming && !editing;
  const canContinue =
    !isUser && isLast && !generating && !message.error && message.content.length > 0;

  // Runnable web code (HTML/CSS/JS) in a finished assistant message gets a
  // sandbox with an audit-and-fix loop. Skipped while streaming (the fences may
  // be incomplete) and for user messages.
  const webSource = useMemo(
    () =>
      !isUser && !message.streaming && !message.error ? extractWebSource(message.content) : null,
    [isUser, message.streaming, message.error, message.content],
  );

  // Web-search status/citations ride on metadata (set by useChat), so no new
  // Message field is needed. `searching` is true only while the query is in
  // flight; `sources` persists after it resolves.
  const searching = message.metadata?.searching === true;
  const sources = (message.metadata?.sources as Source[] | undefined) ?? [];
  // Agentic search phase: planning → searching → analyzing. Drives the
  // multi-step status indicator so the user sees the model plan, then search,
  // then reason over results instead of one opaque "Searching…".
  const searchPhase = message.metadata?.searchPhase as
    'deciding' | 'planning' | 'searching' | 'analyzing' | undefined;
  const plannedQueries = (message.metadata?.plannedQueries as string[] | undefined) ?? [];
  // Auto mode only: the planner decided the web wasn't needed. Worth saying
  // once, so the absence of sources reads as a decision rather than a failure.
  const searchSkipped = message.metadata?.searchSkipped === true;
  const searchSkipReason = message.metadata?.searchSkipReason as string | undefined;

  // Only the newest message plays the entrance animation. Animating every
  // bubble on mount means a 50-message conversation fires 50 simultaneous
  // transitions on load/convo-switch — visible jank for zero benefit, since
  // settled history should just be there. Older bubbles render static.
  const motionProps = isLast
    ? {
        initial: { opacity: 0, y: 6 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.2, ease: 'easeOut' as const },
      }
    : {};

  return (
    <m.div
      {...motionProps}
      className={cn(
        'group/msg chat-container flex gap-3 py-6 sm:gap-4',
        // Native windowing: skip layout/paint for offscreen, settled messages.
        // The live/streaming message stays fully rendered.
        !message.streaming && 'cv-auto',
      )}
    >
      {/* Avatar. The assistant carries the lamp fill, the user an outline — the
          cheapest way to make the two roles readable at a glance while scanning
          a long thread. */}
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
          isUser
            ? 'border-border/22 border bg-surface-raised text-content-muted'
            : 'accent-gradient text-accent-fg shadow-[0_2px_10px_-2px_rgb(var(--lamp)/0.5)]',
        )}
        aria-hidden
      >
        {isUser ? (
          <User className="h-[0.9rem] w-[0.9rem]" />
        ) : (
          <Sparkles className="h-[0.9rem] w-[0.9rem]" />
        )}
      </div>

      {/* Body. The user turn is a contained block; the assistant turn runs full
          width with a lit rail, so answers read like a document and prompts read
          like an aside.

          The user block is a card rather than a 2px outline: on the night field a
          hairline plus the raised fill plus a drop shadow reads as a physical
          object, where a heavy rule just read as a wireframe. */}
      <div
        className={cn(
          'min-w-0 flex-1',
          isUser
            ? 'border-border/16 rounded-lg border bg-surface-raised px-4 py-3 shadow-subtle'
            : 'border-l-2 border-accent/55 pl-4',
        )}
      >
        <div className="mb-1.5 flex items-center gap-2">
          <span className={cn('type-label', isUser ? 'text-content-muted' : 'text-accent')}>
            {isUser ? 'You' : 'Ragent'}
          </span>
          {message.model && !isUser && (
            <span className="bg-border/8 rounded px-1.5 py-0.5 font-mono text-[0.66rem] tracking-wide text-content-subtle">
              {message.model.replace(/:latest$/, '')}
            </span>
          )}
        </div>

        {/* Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {message.attachments.map((a) => {
              const preview = attachmentPreview(a);
              return preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={a.id}
                  src={preview}
                  alt={a.name}
                  className="h-24 w-24 rounded-lg border border-border/15 object-cover"
                />
              ) : (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border/15 bg-border/5 px-2 py-1 text-xs text-content-muted"
                >
                  {a.name}
                </span>
              );
            })}
          </div>
        )}

        {/* Web-search status: a multi-phase indicator for agentic search
            (plan → search → analyze), shown before the answer streams in. */}
        {!isUser && searching && (
          <div className="mb-2 inline-flex max-w-full items-center gap-2 rounded-md border border-border/15 bg-border/5 px-2.5 py-1.5 text-xs text-content-muted">
            <Globe className="h-3.5 w-3.5 shrink-0 animate-pulse text-accent" />
            <span className="min-w-0">
              {searchPhase === 'deciding'
                ? 'Checking whether this needs a search…'
                : searchPhase === 'planning'
                  ? 'Planning the search…'
                  : searchPhase === 'analyzing'
                    ? 'Reading results…'
                    : plannedQueries.length > 0
                      ? `Searching: ${plannedQueries.join(', ')}`
                      : 'Searching the web…'}
            </span>
          </div>
        )}

        {/* Auto mode declined to search. Stated once, quietly — the point is
            that no sources is a choice here, not a broken search. */}
        {!isUser && !searching && searchSkipped && (
          <div className="mb-2 inline-flex max-w-full items-center gap-2 rounded-md border border-border/15 px-2.5 py-1.5 text-xs text-content-subtle">
            <Globe className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0">
              {searchSkipReason
                ? `Answered without searching — ${searchSkipReason}`
                : 'Answered without searching'}
            </span>
          </div>
        )}

        {/* Reasoning: the model's thinking stream, shown in a collapsible panel
            that auto-expands while thinking and collapses once the answer starts. */}
        {!isUser && message.reasoning && (
          <ReasoningPanel
            reasoning={message.reasoning}
            thinking={message.streaming === true}
            hasContent={message.content.length > 0}
            effort={message.metadata?.effort as ThinkingEffort | undefined}
          />
        )}

        {/* Content */}
        {editing ? (
          <div className="space-y-2">
            <textarea
              aria-label="Edit message"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(12, draft.split('\n').length + 1)}
              autoFocus
              className="input resize-none font-sans"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitEdit();
                if (e.key === 'Escape') setEditing(false);
              }}
            />
            <div className="flex gap-2">
              <button onClick={submitEdit} className="btn-primary h-8 px-3 text-xs">
                Save &amp; submit
              </button>
              <button onClick={() => setEditing(false)} className="btn-ghost h-8 px-3 text-xs">
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
            </div>
          </div>
        ) : message.error ? (
          <div className="flex items-start gap-2 rounded-xl border border-error/30 bg-error/5 p-3 text-sm text-error">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <p>{message.error}</p>
              <button
                onClick={() => actions.onRetry(message.id)}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-error/10 px-2.5 py-1 text-xs font-medium text-error hover:bg-error/20"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </button>
            </div>
          </div>
        ) : isUser ? (
          <div className="whitespace-pre-wrap break-words text-[0.95rem] leading-7 text-content">
            {message.content}
          </div>
        ) : message.content ? (
          <div className={message.streaming ? 'streaming-caret' : undefined}>
            <Markdown content={message.content} streaming={message.streaming} />
          </div>
        ) : message.streaming ? (
          <div className="py-1">
            <TypingIndicator />
          </div>
        ) : null}

        {/* Sandbox: run + auto-fix the message's web code. */}
        {webSource && (
          <SandboxPanel
            conversationId={conversationId}
            source={webSource}
            streaming={message.streaming}
          />
        )}

        {/* Metrics */}
        {!isUser && message.metrics && !message.streaming && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {message.metrics.tokensPerSecond != null && (
              <MetricPill label="tok/s" value={message.metrics.tokensPerSecond.toFixed(1)} />
            )}
            {message.metrics.completionTokens != null && (
              <MetricPill label="tokens" value={formatNumber(message.metrics.completionTokens)} />
            )}
            {message.metrics.responseTimeMs != null && (
              <MetricPill label="" value={formatDuration(message.metrics.responseTimeMs)} />
            )}
          </div>
        )}

        {/* Sources: citations from a web-search-augmented turn. Numbered to
            match the inline [1], [2] the model is prompted to use. */}
        {!isUser && !message.streaming && sources.length > 0 && (
          <div className="mt-3 border-t border-border/15 pt-2">
            <div className="mb-1.5 flex items-center gap-1.5 text-[0.68rem] font-bold uppercase tracking-[0.08em] text-content-subtle">
              <Globe className="h-3 w-3" /> Sources
            </div>
            <ol className="space-y-1">
              {sources.map((src, i) => (
                <li key={src.url + i} className="flex gap-1.5 text-xs">
                  <span className="tabular-nums text-content-subtle">[{i + 1}]</span>
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="focus-ring truncate rounded text-content-muted underline decoration-border underline-offset-2 hover:text-accent"
                    title={src.url}
                  >
                    {src.title || src.url}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Action bar. Visible by default so touch users can always reach it —
            only pointers that genuinely support hover (mouse/trackpad) get
            the idle-hidden, hover-to-reveal treatment. */}
        {showActions && (
          <div className="-ml-1 mt-1 flex items-center gap-0.5 opacity-100 transition-opacity [@media(hover:hover)]:ml-0 [@media(hover:hover)]:mt-2 [@media(hover:hover)]:gap-1 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:focus-within:opacity-100 [@media(hover:hover)]:group-hover/msg:opacity-100">
            <ActionBtn label={copied ? 'Copied' : 'Copy'} onClick={copy}>
              {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
            </ActionBtn>
            {isUser && (
              <ActionBtn
                label="Edit"
                onClick={() => {
                  setDraft(message.content);
                  setEditing(true);
                }}
              >
                <Pencil className="h-4 w-4" />
              </ActionBtn>
            )}
            {!isUser && (
              <ActionBtn label="Regenerate" onClick={() => actions.onRegenerate(message.id)}>
                <RefreshCw className="h-4 w-4" />
              </ActionBtn>
            )}
            {canContinue && (
              <ActionBtn label="Continue" onClick={() => actions.onContinue(message.id)}>
                <CornerDownRight className="h-4 w-4" />
              </ActionBtn>
            )}
            <ActionBtn label="Delete" onClick={() => actions.onDelete(message.id)}>
              <Trash2 className="h-4 w-4" />
            </ActionBtn>
          </div>
        )}
      </div>
    </m.div>
  );
});

/**
 * Collapsible panel showing the model's reasoning stream. Auto-expands while
 * the model is still thinking (content hasn't started), then auto-collapses
 * once the answer begins — matching the "show the thinking, then tuck it away"
 * pattern from other chat UIs. A manual toggle overrides the auto behavior.
 */
function ReasoningPanel({
  reasoning,
  thinking,
  hasContent,
  effort,
}: {
  reasoning: string;
  thinking: boolean;
  hasContent: boolean;
  effort?: ThinkingEffort;
}) {
  // Live reasoning (thinking, no answer yet) starts open. Once the answer
  // arrives or streaming ends, default to collapsed. `manual` pins the state
  // once the user clicks, so auto-collapse doesn't yank it shut mid-read.
  const liveThinking = thinking && !hasContent;
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? liveThinking;

  // "Max" effort gets the ultracode treatment — a shimmering gradient sweep on
  // the label + a soft accent glow around the panel — but only while it's
  // actively thinking. Once the answer lands it settles into the normal panel.
  const maxThinking = liveThinking && effort === 'max';

  return (
    <div
      className={cn(
        'reasoning-panel mb-2 overflow-hidden rounded-xl border border-border/15 bg-border/5',
        maxThinking && 'reasoning-panel-max',
      )}
    >
      <button
        onClick={() => setManual(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-content-muted transition-colors hover:bg-border/10"
      >
        <Brain
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-accent',
            liveThinking && !maxThinking && 'animate-pulse',
            maxThinking && 'reasoning-brain-max',
          )}
        />
        <span className={cn('flex-1', maxThinking && 'reasoning-shimmer')}>
          {liveThinking ? (maxThinking ? 'Thinking harder…' : 'Thinking…') : 'Thought process'}
        </span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <m.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            <div
              className={cn(
                'whitespace-pre-wrap break-words border-t border-border/15 px-3 py-2 text-[0.82rem] leading-6 text-content-subtle',
                // While thinking is live, cap the height so a long reasoning
                // stream stays contained instead of shoving the answer offscreen.
                liveThinking && 'max-h-64 overflow-y-auto',
              )}
            >
              {reasoning}
              {liveThinking && <span className="streaming-caret" />}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ActionBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={label}>
      <button
        onClick={onClick}
        aria-label={label}
        // 44px on touch, the minimum comfortable tap target; 36px back on
        // pointer devices, where the row is hover-revealed and wants to stay
        // dense. The icon is the same size either way — only the box grows.
        className="focus-ring flex h-11 w-11 items-center justify-center rounded-lg text-content-subtle transition-colors hover:bg-border/5 hover:text-content active:bg-border/10 [@media(hover:hover)]:h-9 [@media(hover:hover)]:w-9"
      >
        {children}
      </button>
    </Tooltip>
  );
}
