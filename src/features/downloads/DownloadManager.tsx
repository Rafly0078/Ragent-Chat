'use client';

import { AnimatePresence, m } from 'framer-motion';
import { Download, File, FileText, FileSpreadsheet, Presentation, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { formatBytes } from '@/lib/utils/format';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/cn';

interface DownloadItem {
  id: string;
  name: string;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  progress: number;
  size: number;
  url?: string;
  error?: string;
  createdAt: number;
}

interface Props {
  downloads: DownloadItem[];
  onRetry?: (id: string) => void;
  onDelete?: (id: string) => void;
  onDownload?: (item: DownloadItem) => void;
}

function statusColor(status: DownloadItem['status']) {
  switch (status) {
    case 'ready': return 'text-success';
    case 'processing': return 'text-warning';
    case 'pending': return 'text-content-subtle';
    case 'failed': return 'text-error';
  }
}

function statusLabel(status: DownloadItem['status']) {
  switch (status) {
    case 'ready': return 'Ready';
    case 'processing': return 'Processing';
    case 'pending': return 'Pending';
    case 'failed': return 'Failed';
  }
}

function kindIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'pdf': case 'docx': return <FileText className="h-4 w-4" />;
    case 'pptx': return <Presentation className="h-4 w-4" />;
    case 'xlsx': case 'csv': return <FileSpreadsheet className="h-4 w-4" />;
    default: return <File className="h-4 w-4" />;
  }
}

export function DownloadManager({ downloads, onRetry, onDelete, onDownload }: Props) {
  if (downloads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-border/5">
          <Download className="h-5 w-5 text-content-subtle" />
        </div>
        <p className="text-sm text-content-muted">No downloads yet</p>
        <p className="text-xs text-content-subtle">Generated documents will appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <AnimatePresence initial={false}>
        {downloads.map((item) => (
          <m.div
            key={item.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            className="group/dl flex items-center gap-3 rounded-xl border-2 border-border bg-surface-raised p-3 shadow-subtle transition-colors hover:border-accent/30"
          >
            <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10', statusColor(item.status))}>
              {item.status === 'processing' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                kindIcon(item.name)
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-content">{item.name}</p>
              {/* aria-live: a screen-reader user otherwise got no notification
                  when a download became available or failed — the only cue was a
                  colour change. */}
              <div className="flex items-center gap-2 text-[0.7rem]" aria-live="polite">
                <span className={cn('font-medium', statusColor(item.status))}>{statusLabel(item.status)}</span>
                {item.size > 0 && <span className="text-content-subtle">{formatBytes(item.size)}</span>}
                {item.error && <span className="text-error">{item.error}</span>}
              </div>
              {item.status === 'processing' && (
                <div
                  className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border/10"
                  role="progressbar"
                  aria-valuenow={Math.round(item.progress)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${item.name} progress`}
                >
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-300"
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
              )}
            </div>
            {/* Reveal on hover only where hover actually exists, and always on
                focus. Hiding these behind `opacity-0` left touch users with no
                reachable Download button at all — the whole point of this panel —
                and made keyboard focus invisible. */}
            <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:focus-within:opacity-100 [@media(hover:hover)]:group-hover/dl:opacity-100">
              {item.status === 'ready' && item.url && (
                <Tooltip label="Download">
                  <button
                    onClick={() => onDownload?.(item)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-content-subtle hover:bg-border/5 hover:text-content"
                    aria-label="Download"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              )}
              {item.status === 'failed' && onRetry && (
                <Tooltip label="Retry">
                  <button
                    onClick={() => onRetry(item.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-content-subtle hover:bg-border/5 hover:text-content"
                    aria-label="Retry"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              )}
              {onDelete && (
                <Tooltip label="Delete">
                  <button
                    onClick={() => onDelete(item.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-content-subtle hover:bg-error/10 hover:text-error"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              )}
            </div>
          </m.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
