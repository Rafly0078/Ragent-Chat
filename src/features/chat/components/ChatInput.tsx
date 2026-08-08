'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import {
  ArrowUp,
  Brain,
  FileText,
  Globe,
  Loader2,
  Paperclip,
  Plus,
  Square,
  X,
  Check,
  Command,
} from 'lucide-react';
import type { Attachment, ThinkingConfig } from '@/types';
import { attachmentPreview, fileToAttachment } from '@/lib/utils/files';
import { estimateTokens } from '@/lib/utils/format';
import { SLASH_COMMANDS, THINKING_EFFORTS } from '@/lib/store/defaults';
import { useSettings } from '@/lib/store/settings-store';
import { useToast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/cn';
import { DocumentEditDialog } from '@/features/documents/DocumentEditDialog';

interface Props {
  disabled?: boolean;
  generating: boolean;
  onSend: (text: string, attachments: Attachment[], webSearch: boolean) => void;
  onStop: () => void;
  onSlashCommand: (command: string) => void;
  visionCapable?: boolean;
  conversationId?: string | null;
  /** Extended thinking configuration for this conversation. */
  thinking: ThinkingConfig;
  /** Whether the current model is known to not support thinking. */
  thinkingUnsupported: boolean;
  /** Update the thinking config (toggle on/off, change effort). */
  onThinkingChange: (patch: Partial<ThinkingConfig>) => void;
}

const MAX_TEXTAREA_PX = 220;

export function ChatInput({
  disabled,
  generating,
  onSend,
  onStop,
  onSlashCommand,
  visionCapable,
  conversationId,
  thinking,
  thinkingUnsupported,
  onThinkingChange,
}: Props) {
  const [docEditOpen, setDocEditOpen] = useState(false);
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const effortRef = useRef<HTMLDivElement>(null);
  const dragCounter = useRef(0);
  const { toast } = useToast();
  const sendOnEnter = useSettings((s) => s.sendOnEnter);
  const showTokenCounter = useSettings((s) => s.showTokenCounter);

  // Close the tools menu and effort popover on outside click or Escape.
  useEffect(() => {
    if (!menuOpen && !effortOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
      if (effortOpen && effortRef.current && !effortRef.current.contains(e.target as Node))
        setEffortOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setEffortOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen, effortOpen]);

  const slashOpen = value.startsWith('/') && !value.includes(' ');
  const slashMatches = slashOpen
    ? SLASH_COMMANDS.filter((c) => c.command.startsWith(value.toLowerCase()))
    : [];

  // Auto-grow the textarea.
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, []);

  useEffect(() => resize(), [value, resize]);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      setBusy(true);
      const next: Attachment[] = [];
      for (const file of Array.from(files)) {
        try {
          next.push(await fileToAttachment(file));
        } catch (err) {
          toast(err instanceof Error ? err.message : `Couldn't attach ${file.name}`, 'error');
        }
      }
      if (next.length) setAttachments((a) => [...a, ...next]);
      setBusy(false);
    },
    [toast],
  );

  const submit = useCallback(() => {
    if (disabled || generating) return;
    const trimmed = value.trim();

    // Slash command dispatch (commands without inline templates run actions).
    if (slashOpen) {
      const cmd = SLASH_COMMANDS.find((c) => c.command === trimmed);
      if (cmd) {
        if (cmd.template) {
          onSend(cmd.template, [], false);
        } else {
          onSlashCommand(cmd.command);
        }
        setValue('');
        return;
      }
    }

    if (!trimmed && attachments.length === 0) return;
    onSend(trimmed, attachments, webSearch);
    setValue('');
    setAttachments([]);
  }, [disabled, generating, value, slashOpen, attachments, onSend, onSlashCommand, webSearch]);

  const runCommand = useCallback(
    (cmd: (typeof SLASH_COMMANDS)[number]) => {
      if (cmd.template) {
        onSend(cmd.template, [], false);
      } else {
        onSlashCommand(cmd.command);
      }
      setValue('');
    },
    [onSend, onSlashCommand],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd+Enter always sends. Enter sends when sendOnEnter is on.
    if (e.key === 'Enter') {
      const wantSend = e.metaKey || e.ctrlKey || (sendOnEnter && !e.shiftKey);
      if (wantSend) {
        e.preventDefault();
        // Autocomplete a lone slash match directly — don't setValue then submit
        // on the next frame, which would read the stale (pre-setValue) closure.
        if (slashOpen && slashMatches.length === 1 && slashMatches[0]) {
          runCommand(slashMatches[0]);
        } else {
          submit();
        }
      }
    }
    if (e.key === 'Escape' && generating) onStop();
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const imageItems = Array.from(e.clipboardData.items).filter((i) => i.type.startsWith('image/'));
    if (imageItems.length) {
      e.preventDefault();
      const files = imageItems.map((i) => i.getAsFile()).filter(Boolean) as File[];
      void addFiles(files);
    }
  };

  // Drag & drop with a counter so nested dragenter/leave don't flicker.
  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) setDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current <= 0) setDragging(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
  };

  const tokenCount = estimateTokens(value);

  return (
    <div className="chat-container relative pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-5">
      {/* Slash command palette */}
      <AnimatePresence>
        {slashOpen && slashMatches.length > 0 && (
          <m.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="popover absolute bottom-full left-4 right-4 mb-2 overflow-hidden sm:left-6 sm:right-6"
          >
            {slashMatches.map((c) => (
              <button
                key={c.command}
                onClick={() => runCommand(c)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-border/5"
              >
                <Command className="h-4 w-4 text-accent" />
                <span className="font-mono text-sm text-content">{c.command}</span>
                <span className="truncate text-xs text-content-muted">{c.description}</span>
              </button>
            ))}
          </m.div>
        )}
      </AnimatePresence>

      <div
        onDragEnter={onDragEnter}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          /* The dock is where the light lands: a raised block that warms and
             glows as soon as focus enters it. That glow is spent in exactly two
             places in the product — here and on the hovered primary button — so
             "the thing you type into" is always the brightest surface on screen.
             The old dock was a 2px full-opacity white rule, which read as a
             wireframe rather than a surface. */
          'border-border/22 relative rounded-xl border bg-surface-raised p-2 shadow-raised',
          'transition-[border-color,box-shadow] duration-base ease-out',
          'focus-within:border-accent/55 focus-within:shadow-glow',
          dragging && 'border-accent/70 shadow-glow',
        )}
      >
        {/* Drag overlay */}
        <AnimatePresence>
          {dragging && (
            <m.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="bg-accent/12 absolute inset-0 z-10 flex items-center justify-center rounded-xl backdrop-blur-[2px]"
            >
              <p className="type-label text-accent">Drop files to attach</p>
            </m.div>
          )}
        </AnimatePresence>

        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 p-2">
            {attachments.map((a) => {
              const preview = attachmentPreview(a);
              return (
                <div
                  key={a.id}
                  className="group/att relative flex items-center gap-2 rounded-lg border border-border/20 bg-border/5 py-1 pl-1 pr-2 text-xs"
                >
                  {preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview} alt={a.name} className="h-9 w-9 rounded-lg object-cover" />
                  ) : (
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-border/5">
                      <Paperclip className="h-4 w-4 text-content-muted" />
                    </span>
                  )}
                  <span className="max-w-[120px] truncate text-content-muted">{a.name}</span>
                  <button
                    onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                    className="rounded-md p-0.5 text-content-subtle hover:text-error"
                    aria-label={`Remove ${a.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-end gap-1.5">
          {/* Tools collapsed into one popover so they don't crowd the input. */}
          <div ref={menuRef} className="relative shrink-0">
            <Tooltip label="Tools">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                disabled={disabled}
                aria-label="Open tools"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className={cn(
                  'focus-ring relative flex h-11 w-11 items-center justify-center rounded-md transition-colors duration-fast disabled:opacity-40',
                  menuOpen
                    ? 'bg-accent/15 text-accent'
                    : 'text-content-muted hover:bg-border/10 hover:text-content',
                )}
              >
                <Plus className={cn('h-5 w-5 transition-transform', menuOpen && 'rotate-45')} />
                {webSearch && !menuOpen && (
                  <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent ring-2 ring-surface-raised" />
                )}
              </button>
            </Tooltip>

            <AnimatePresence>
              {menuOpen && (
                <m.div
                  initial={{ opacity: 0, y: 8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.96 }}
                  transition={{ duration: 0.14 }}
                  role="menu"
                  className="popover absolute bottom-full left-0 z-30 mb-2 w-60 overflow-hidden p-1.5"
                >
                  <button
                    role="menuitem"
                    onClick={() => {
                      fileInputRef.current?.click();
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-content transition-colors hover:bg-border/10"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-border/15 text-content-muted">
                      {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Paperclip className="h-4 w-4" />
                      )}
                    </span>
                    <span className="flex-1">
                      <span className="block font-medium">Attach files</span>
                      <span className="block text-xs text-content-subtle">
                        Images, PDF, Office, code
                      </span>
                    </span>
                  </button>

                  <button
                    role="menuitem"
                    onClick={() => {
                      setDocEditOpen(true);
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-content transition-colors hover:bg-border/10"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-border/15 text-content-muted">
                      <FileText className="h-4 w-4" />
                    </span>
                    <span className="flex-1">
                      <span className="block font-medium">Edit a document</span>
                      <span className="block text-xs text-content-subtle">
                        Rewrite a file with AI
                      </span>
                    </span>
                  </button>

                  <button
                    role="menuitemcheckbox"
                    aria-checked={webSearch}
                    onClick={() => setWebSearch((v) => !v)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-content transition-colors hover:bg-border/10"
                  >
                    <span
                      className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                        webSearch ? 'bg-accent text-accent-fg' : 'bg-border/15 text-content-muted',
                      )}
                    >
                      <Globe className="h-4 w-4" />
                    </span>
                    <span className="flex-1">
                      <span className="block font-medium">Web search</span>
                      <span className="block text-xs text-content-subtle">
                        Search before answering
                      </span>
                    </span>
                    {webSearch && <Check className="h-4 w-4 text-accent" />}
                  </button>
                </m.div>
              )}
            </AnimatePresence>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = '';
            }}
          />

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            disabled={disabled}
            rows={1}
            placeholder={disabled ? 'Select model to start' : 'Message...'}
            aria-label="Message input"
            className="scrollbar-thin max-h-[220px] flex-1 resize-none bg-transparent px-1 py-2.5 text-[0.95rem] leading-6 text-content outline-none placeholder:text-content-subtle disabled:opacity-50"
          />

          {/* Thinking toggle + effort selector */}
          <div ref={effortRef} className="relative shrink-0">
            <Tooltip
              label={
                thinkingUnsupported
                  ? "This model doesn't support thinking"
                  : thinking.enabled
                    ? `Thinking: ${thinking.effort}`
                    : 'Enable extended thinking'
              }
            >
              <button
                onClick={() => {
                  if (thinkingUnsupported) return;
                  if (!thinking.enabled) {
                    onThinkingChange({ enabled: true });
                  } else {
                    setEffortOpen((v) => !v);
                  }
                }}
                disabled={disabled || thinkingUnsupported}
                aria-label="Toggle extended thinking"
                aria-haspopup="menu"
                aria-expanded={effortOpen}
                className={cn(
                  'focus-ring relative flex h-11 w-11 items-center justify-center rounded-md transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-40',
                  thinking.enabled
                    ? 'bg-accent/15 text-accent'
                    : 'text-content-muted hover:bg-border/10 hover:text-content',
                )}
              >
                <Brain className="h-5 w-5" />
                {thinking.enabled && !effortOpen && (
                  <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent ring-2 ring-surface-raised" />
                )}
              </button>
            </Tooltip>

            <AnimatePresence>
              {effortOpen && thinking.enabled && !thinkingUnsupported && (
                <m.div
                  initial={{ opacity: 0, y: 8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.96 }}
                  transition={{ duration: 0.14 }}
                  role="menu"
                  className="popover absolute bottom-full right-0 z-30 mb-2 w-48 overflow-hidden p-1.5"
                >
                  <div className="px-3 py-1.5 text-[0.7rem] font-medium uppercase tracking-wide text-content-subtle">
                    Thinking effort
                  </div>
                  {THINKING_EFFORTS.map((effort) => (
                    <button
                      key={effort}
                      role="menuitemradio"
                      aria-checked={thinking.effort === effort}
                      onClick={() => {
                        onThinkingChange({ effort });
                        setEffortOpen(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-content transition-colors hover:bg-border/10"
                    >
                      <span className="flex-1 capitalize">{effort}</span>
                      {thinking.effort === effort && <Check className="h-4 w-4 text-accent" />}
                    </button>
                  ))}
                  <div className="my-1 h-px bg-border/10" />
                  <button
                    role="menuitem"
                    onClick={() => {
                      onThinkingChange({ enabled: false });
                      setEffortOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-content transition-colors hover:bg-border/10"
                  >
                    <X className="h-4 w-4 text-content-muted" />
                    <span className="flex-1">Turn off thinking</span>
                  </button>
                </m.div>
              )}
            </AnimatePresence>
          </div>

          {generating ? (
            <Tooltip label="Stop generating (Esc)">
              <button
                onClick={onStop}
                className="btn-surface h-11 w-11 shrink-0 p-0"
                aria-label="Stop generating"
              >
                <Square className="h-4 w-4 fill-current" />
              </button>
            </Tooltip>
          ) : (
            <button
              onClick={submit}
              disabled={disabled || (!value.trim() && attachments.length === 0)}
              /* No bespoke scale on hover. `.btn-primary` already defines one
                 hover and one press for every button in the product, and a
                 send key that grew while its neighbours did not was exactly
                 the per-page effect the system exists to prevent. */
              className="btn-primary h-11 w-11 shrink-0 p-0"
              aria-label="Send message"
            >
              <ArrowUp className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* Composer metadata. Mono caps, because this is chrome reporting state —
          as a sentence in body type, "Text model" read as a stray caption. */}
      <div className="mt-2 flex items-center justify-between gap-3 px-1">
        <span className="flex min-w-0 items-center gap-2">
          {webSearch && (
            <span className="type-label inline-flex items-center gap-1.5 text-accent">
              <Globe className="h-3 w-3" /> Web search
            </span>
          )}
          {thinking.enabled && !thinkingUnsupported && (
            <span className="type-label inline-flex items-center gap-1.5 text-accent">
              <Brain className="h-3 w-3" /> Thinking · {thinking.effort}
            </span>
          )}
          <span className="type-label truncate text-content-subtle">
            {visionCapable ? 'Vision · images supported' : 'Text only'}
          </span>
        </span>
        {showTokenCounter && value.trim() && (
          <span className="type-label shrink-0 tabular-nums text-content-subtle">
            ~{tokenCount} tokens
          </span>
        )}
      </div>

      <DocumentEditDialog
        open={docEditOpen}
        onClose={() => setDocEditOpen(false)}
        conversationId={conversationId ?? null}
      />
    </div>
  );
}
