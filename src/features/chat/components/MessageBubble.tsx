'use client';

import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import {
  AlertCircle,
  Check,
  Copy,
  Pencil,
  RefreshCw,
  Trash2,
  CornerDownRight,
  Globe,
  X,
  ChevronDown,
} from 'lucide-react';
import type { Message, ThinkingEffort } from '@/types';
import type { Source } from '@/lib/search/types';
import { Markdown } from '@/components/markdown/Markdown';
import { BrandMark } from '@/components/BrandMark';
import { Tooltip } from '@/components/ui/tooltip';
/**
 * Code-split: 292 lines plus the sandbox runner and self-heal loop, rendered
 * only for the rare message that actually contains runnable web source, but
 * downloaded as part of the chat route by every visitor when imported statically.
 */
const SandboxPanel = lazy(() =>
  import('@/features/sandbox/SandboxPanel').then((m) => ({ default: m.SandboxPanel })),
);
import { extractWebSource } from '@/lib/sandbox/compose';
import { ThinkingField } from './ThinkingField';
import { attachmentPreview } from '@/lib/utils/files';
import { clockTime, formatDuration, formatNumber } from '@/lib/utils/format';
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

/** One response metric, on the shared chip chrome. */
function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="term-chip">
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
  // Agentic search phase: deciding → planning → searching. Drives the status
  // line so the user sees the model plan and then search, not one opaque
  // "Searching…". There is deliberately no `analyzing` branch: `use-chat` sets
  // `searching: false` in the same write that sets it, so the gate below can
  // never be true at that phase and the label was unreachable.
  const searchPhase = message.metadata?.searchPhase as
    'deciding' | 'planning' | 'searching' | 'analyzing' | undefined;
  const plannedQueries = (message.metadata?.plannedQueries as string[] | undefined) ?? [];
  // Auto mode only: the planner decided the web wasn't needed. Worth saying
  // once, so the absence of sources reads as a decision rather than a failure.
  const searchSkipped = message.metadata?.searchSkipped === true;
  const searchSkipReason = message.metadata?.searchSkipReason as string | undefined;

  // Only the newest message plays the entrance animation. Animating every turn
  // on mount means a 50-message conversation fires 50 simultaneous transitions
  // on load or convo-switch — visible jank for zero benefit, since settled
  // history should just be there.
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
      data-turn={message.role}
      className={cn(
        'turn chat-container',
        // Native windowing: skip layout/paint for offscreen, settled turns. The
        // live one stays fully rendered.
        !message.streaming && 'cv-auto',
      )}
    >
      {/* who ─────────── time. The rule is what a bubble's border was for. */}
      <div className="turn-rail">
        <span className="turn-who">
          {isUser ? 'you' : (message.model?.replace(/:latest$/, '') ?? 'ragent')}
        </span>
        <span aria-hidden className="turn-rule" />
        <span className="turn-time">{clockTime(message.createdAt)}</span>
      </div>

      <div className="turn-body">
        {message.attachments && message.attachments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {message.attachments.map((a) => {
              const preview = attachmentPreview(a);
              return preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={a.id}
                  src={preview}
                  alt={a.name}
                  className="h-24 w-24 rounded-sm border border-border/15 object-cover"
                />
              ) : (
                <span key={a.id} className="term-chip">
                  {a.name}
                </span>
              );
            })}
          </div>
        )}

        {/* Web-search status, before the answer streams in. */}
        {!isUser && searching && (
          <div className="mb-3 inline-flex max-w-full items-center gap-2 font-mono text-xs text-content-muted">
            <Globe className="h-3.5 w-3.5 shrink-0 animate-pulse" />
            <span className="min-w-0">
              {searchPhase === 'deciding'
                ? 'checking whether this needs a search'
                : searchPhase === 'planning'
                  ? 'planning the search'
                  : plannedQueries.length > 0
                    ? `searching: ${plannedQueries.join(', ')}`
                    : 'searching the web'}
            </span>
          </div>
        )}

        {/* Auto mode declined to search. Stated once, quietly — the point is
            that no sources is a choice here, not a broken search. */}
        {!isUser && !searching && searchSkipped && (
          <div className="mb-3 inline-flex max-w-full items-center gap-2 font-mono text-xs text-content-subtle">
            <Globe className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0">
              {searchSkipReason
                ? `answered without searching — ${searchSkipReason}`
                : 'answered without searching'}
            </span>
          </div>
        )}

        {/* Content. For an assistant message this is an ORDERED walk over
            text/thinking segments, so a model that thinks, answers, then thinks
            again renders in that order. */}
        {editing ? (
          <div className="space-y-2">
            <textarea
              aria-label="Edit message"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(12, draft.split('\n').length + 1)}
              autoFocus
              className="input resize-none font-mono"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitEdit();
                if (e.key === 'Escape') setEditing(false);
              }}
            />
            <div className="flex gap-2">
              <button onClick={submitEdit} className="term-btn term-btn-solid focus-ring h-9 px-3">
                save &amp; submit
              </button>
              <button
                onClick={() => setEditing(false)}
                className="term-btn term-btn-ghost focus-ring h-9 px-3"
              >
                <X className="h-3.5 w-3.5" /> cancel
              </button>
            </div>
          </div>
        ) : message.error ? (
          <div className="flex items-start gap-2 border-l-2 border-error/60 pl-3 text-sm text-error">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <p>{message.error}</p>
              <button
                onClick={() => actions.onRetry(message.id)}
                className="focus-ring mt-2 inline-flex items-center gap-1.5 rounded-sm font-mono text-xs text-error underline decoration-error/40 underline-offset-2 hover:decoration-error"
              >
                <RefreshCw className="h-3.5 w-3.5" /> retry
              </button>
            </div>
          </div>
        ) : isUser ? (
          <div className="turn-echo">
            <span aria-hidden className="term-prompt">
              &gt;
            </span>
            <span>{message.content}</span>
          </div>
        ) : (
          <MessageBody message={message} />
        )}

        {/* Sandbox: run + auto-fix the message's web code. */}
        {webSource && (
          <Suspense fallback={null}>
            <SandboxPanel
              conversationId={conversationId}
              source={webSource}
              streaming={message.streaming}
            />
          </Suspense>
        )}

        {!isUser && message.metrics && !message.streaming && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
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
          <div className="mt-4 border-t border-border/15 pt-2.5">
            <div className="mb-1.5 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-content-subtle">
              sources
            </div>
            <ol className="space-y-1">
              {sources.map((src, i) => (
                <li key={src.url + i} className="flex gap-2 font-mono text-xs">
                  <span className="tabular-nums text-content-subtle">[{i + 1}]</span>
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="focus-ring truncate rounded-sm text-content-muted underline decoration-border/40 underline-offset-2 hover:text-content"
                    title={src.url}
                  >
                    {src.title || src.url}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        )}

        {showActions && (
          <div className="turn-actions">
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
 * An assistant message body, rendered as an ORDERED sequence of segments.
 *
 * The old layout was structurally "all thinking, then all text": one reasoning
 * panel rendered as a sibling above the content, and since reasoning was a single
 * flat string there was only ever one of them. A model that thought, answered,
 * then thought again could not be shown truthfully.
 *
 * Messages that predate `parts` — and every user message — fall back to the flat
 * pair, which reproduces exactly what they used to look like.
 */
function MessageBody({ message }: { message: Message }) {
  const streaming = message.streaming === true;
  const effort = message.metadata?.effort as ThinkingEffort | undefined;
  const parts = message.parts;
  const lastPart = parts?.[parts.length - 1];

  // Two live states, both derived from what already exists on the message.
  // `working` is everything before the first text token; `openThinking` narrows it
  // to "a thinking block is streaming right now".
  //
  // Only the second one gets the THINKING wordmark, because only there is the word
  // true: before the first part arrives the model may not even have thinking
  // enabled, and the indicator this replaces claimed it either way. That case gets
  // a bare caret — the same one the composer and the landing use.
  const working = streaming && lastPart?.kind !== 'text';
  const openThinking = working && lastPart?.kind === 'thinking' && lastPart.endedAt === undefined;

  if (!parts?.length) {
    return (
      <>
        {message.reasoning && (
          <ReasoningPanel
            text={message.reasoning}
            active={streaming && message.content.length === 0}
            effort={effort}
            durationMs={message.reasoningTimeMs}
          />
        )}
        {message.content ? (
          <div className={streaming ? 'streaming-caret' : undefined}>
            <Markdown content={message.content} streaming={streaming} />
          </div>
        ) : streaming ? (
          <Working thinking={Boolean(message.reasoning)} />
        ) : null}
      </>
    );
  }

  // Only the final segment of a live message carries the caret and the "thinking
  // now" treatment. Keying that off `!hasContent` — as the old one did — is wrong
  // the moment interleaving exists, because block 2 starts *after* content is
  // already on screen.
  const lastIndex = parts.length - 1;
  const thinkingOrdinals = new Map<number, number>();
  let seen = 0;
  for (const [i, p] of parts.entries()) {
    if (p.kind === 'thinking') thinkingOrdinals.set(i, ++seen);
  }
  const totalThinking = seen;

  return (
    <>
      {parts.map((part, i) => {
        const isLast = i === lastIndex;
        if (part.kind === 'thinking') {
          return (
            <ReasoningPanel
              key={`t${part.index}-${i}`}
              text={part.text}
              active={streaming && isLast && part.endedAt === undefined}
              effort={effort}
              durationMs={part.endedAt !== undefined ? part.endedAt - part.startedAt : undefined}
              ordinal={totalThinking > 1 ? thinkingOrdinals.get(i) : undefined}
              interrupted={part.interrupted}
              redacted={part.redacted}
            />
          );
        }
        return (
          <div
            key={`c${part.index}-${i}`}
            className={streaming && isLast ? 'streaming-caret' : undefined}
          >
            <Markdown content={part.text} streaming={streaming && isLast} />
          </div>
        );
      })}
      {/* Below the live panel rather than above it: with interleaved thinking,
          "above" would put the field over an answer already delivered. */}
      {working && <Working thinking={openThinking} />}
    </>
  );
}

/**
 * The gap between a turn starting and its first token of prose.
 *
 * `thinking` is the narrow claim — a thinking block is streaming right now — and
 * it is the only thing that earns the wordmark. Everything else is a caret.
 */
function Working({ thinking }: { thinking: boolean }) {
  return (
    <div className="mt-4">
      {thinking ? (
        <ThinkingField />
      ) : (
        <span role="status" aria-label="Working" className="thinking-wait">
          <span aria-hidden className="term-caret animate-caret-blink" />
        </span>
      )}
    </div>
  );
}

/**
 * One thinking block, as an aside rather than a card.
 *
 * Auto-expands while that block is the one actively streaming, then collapses. A
 * manual toggle pins the state so auto-collapse cannot yank it shut mid-read.
 *
 * The mark in the head is the still version of the ASCII field below it: while the
 * model is working the mark moves, and once it stops this is what is left of it.
 * The "max effort" flourish that used to live here — a shimmering gradient label,
 * a glowing border and a pulsing icon — is now one honest word in the label.
 */
function ReasoningPanel({
  text,
  active,
  effort,
  durationMs,
  ordinal,
  interrupted,
  redacted,
}: {
  text: string;
  /** This specific block is streaming right now. */
  active: boolean;
  effort?: ThinkingEffort;
  durationMs?: number;
  /** 1-based position among this message's thinking blocks; omitted when there's one. */
  ordinal?: number;
  interrupted?: boolean;
  redacted?: boolean;
}) {
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? active;

  // Duration was declared on the message type and never once written or read.
  // Now it is per block, which is the only place it means anything — and it reads
  // better folded into the label than as a number floating on the right.
  const settled = interrupted
    ? 'stopped'
    : redacted
      ? 'encrypted'
      : durationMs !== undefined && durationMs >= 100
        ? `thought for ${formatDuration(durationMs)}`
        : 'thought process';

  return (
    <div className="reason">
      <button
        onClick={() => setManual(!open)}
        aria-expanded={open}
        className="reason-head focus-ring rounded-sm"
      >
        <BrandMark className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 text-left">
          {active ? (effort === 'max' ? 'thinking harder' : 'thinking') : settled}
          {ordinal !== undefined && <span className="ml-1.5 tabular-nums">#{ordinal}</span>}
        </span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            <div
              className={cn(
                'reason-text',
                // While this block is live, cap the height so a long reasoning
                // stream stays contained instead of shoving the answer offscreen.
                active && 'scrollbar-thin max-h-56 overflow-y-auto',
              )}
            >
              {redacted && !text ? (
                <span className="italic">
                  The provider returned this reasoning encrypted, so there is nothing to show.
                </span>
              ) : (
                text
              )}
              {active && <span className="streaming-caret" />}
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
        // 44px on touch, the minimum comfortable tap target; 32px back on pointer
        // devices, where the row is hover-revealed and wants to stay dense. The
        // icon is the same size either way — only the box grows.
        className="focus-ring flex h-11 w-11 items-center justify-center rounded-sm text-content-subtle transition-colors hover:bg-border/10 hover:text-content active:bg-border/15 [@media(hover:hover)]:h-8 [@media(hover:hover)]:w-8"
      >
        {children}
      </button>
    </Tooltip>
  );
}
