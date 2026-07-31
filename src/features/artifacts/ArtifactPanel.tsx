'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import {
  AlertTriangle,
  ChevronDown,
  Download,
  File,
  FileText,
  FileCode,
  FileSpreadsheet,
  FileJson,
  Presentation,
  Globe,
  Trash2,
  Eye,
  X,
} from 'lucide-react';
import type { Artifact, ArtifactKind } from '@/lib/tools/types';
import { Tooltip } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils/cn';

interface Props {
  artifacts: Artifact[];
  onDelete?: (id: string) => void;
}

/** Cap on the inline text preview so a huge CSV/JSON can't lock up the main thread. */
const MAX_PREVIEW_CHARS = 200_000;

/** Click a temporary anchor to save `url` as `filename`. */
function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Per-kind icon + colour so each file type is recognizable at a glance. */
const KIND_STYLE: Record<
  ArtifactKind,
  { icon: React.ComponentType<{ className?: string }>; tile: string; label: string }
> = {
  pdf: { icon: FileText, tile: 'bg-red-500/15 text-red-500', label: 'PDF' },
  docx: { icon: FileText, tile: 'bg-blue-500/15 text-blue-500', label: 'Word' },
  pptx: { icon: Presentation, tile: 'bg-orange-500/15 text-orange-500', label: 'Slides' },
  xlsx: { icon: FileSpreadsheet, tile: 'bg-emerald-500/15 text-emerald-500', label: 'Excel' },
  csv: { icon: FileSpreadsheet, tile: 'bg-emerald-500/15 text-emerald-500', label: 'CSV' },
  html: { icon: Globe, tile: 'bg-purple-500/15 text-purple-500', label: 'HTML' },
  json: { icon: FileJson, tile: 'bg-amber-500/15 text-amber-600', label: 'JSON' },
  xml: { icon: FileCode, tile: 'bg-teal-500/15 text-teal-500', label: 'XML' },
  md: { icon: FileCode, tile: 'bg-sky-500/15 text-sky-500', label: 'Markdown' },
  txt: { icon: FileText, tile: 'bg-slate-500/15 text-slate-500', label: 'Text' },
  zip: { icon: File, tile: 'bg-yellow-500/15 text-yellow-600', label: 'ZIP' },
};

function kindStyle(kind: ArtifactKind) {
  return (
    KIND_STYLE[kind] ?? {
      icon: File,
      tile: 'bg-border/20 text-content-muted',
      label: kind.toUpperCase(),
    }
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ArtifactCard({
  artifact,
  stale,
  onDelete,
}: {
  artifact: Artifact;
  /** Signed URL could not be renewed — the link is expected to fail. */
  stale?: boolean;
  onDelete?: (id: string) => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const isPreviewable = ['html', 'md', 'txt', 'json', 'xml', 'csv'].includes(artifact.kind);
  const { icon: Icon, tile, label } = kindStyle(artifact.kind);
  const { toast } = useToast();

  /**
   * The `download` attribute is ignored for cross-origin URLs, and Supabase
   * serves signed URLs with `Content-Disposition: inline` — so clicking "Unduh"
   * used to *navigate the tab* to the file (tearing down the SPA) instead of
   * saving it. Fetch to a blob and download that.
   */
  const handleDownload = async () => {
    const url = artifact.url;
    if (!url || downloading) return;
    if (url.startsWith('data:')) {
      triggerDownload(url, artifact.name);
      return;
    }
    setDownloading(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const objectUrl = URL.createObjectURL(await res.blob());
      triggerDownload(objectUrl, artifact.name);
      // Revoke on the next tick so Safari has time to start the download.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      toast('Gagal mengunduh — tautan mungkin sudah kedaluwarsa. Muat ulang halaman.', 'error');
    } finally {
      setDownloading(false);
    }
  };

  // Decoding a multi-megabyte data: URL is `atob` + a full TextDecoder pass, and
  // it used to run inline in JSX — i.e. on every re-render of the open modal,
  // including each animation frame. Memoized and capped.
  const textPreview = useMemo(() => {
    if (!previewOpen || artifact.kind === 'html') return '';
    if (!artifact.url?.startsWith('data:')) return 'Pratinjau tidak tersedia untuk format ini.';
    const decoded = decodePreview(artifact.url);
    return decoded.length > MAX_PREVIEW_CHARS
      ? `${decoded.slice(0, MAX_PREVIEW_CHARS)}\n\n… (pratinjau dipotong — unduh untuk melihat semuanya)`
      : decoded;
  }, [previewOpen, artifact.kind, artifact.url]);

  return (
    <>
      <m.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="group/art card lift flex items-center gap-3 p-3 hover:border-accent/40 sm:p-3.5"
      >
        {/* File-type tile */}
        <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-md', tile)}>
          <Icon className="h-6 w-6" />
        </div>

        {/* Meta */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-content" title={artifact.name}>
            {artifact.name}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.7rem] text-content-subtle">
            <span className="inline-flex items-center gap-1 rounded-md bg-border/15 px-1.5 py-0.5 font-medium text-content-muted">
              {label}
            </span>
            <span className="tabular-nums">{formatSize(artifact.size)}</span>
            {artifact.ephemeral && (
              <Tooltip
                side="top"
                label="Belum tersimpan ke cloud. Unduh sekarang — file hilang setelah halaman ditutup."
              >
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-600">
                  <AlertTriangle className="h-3 w-3" />
                  Sementara
                </span>
              </Tooltip>
            )}
            {stale && (
              <Tooltip
                side="top"
                label="Tautan file gagal diperbarui. Muat ulang halaman untuk mencoba lagi."
              >
                <span className="inline-flex items-center gap-1 rounded-md bg-error/15 px-1.5 py-0.5 font-medium text-error">
                  <AlertTriangle className="h-3 w-3" />
                  Kedaluwarsa
                </span>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Actions — always visible so they work on touch and never hide */}
        <div className="flex shrink-0 items-center gap-1">
          {isPreviewable && artifact.url && (
            <Tooltip side="top" label="Pratinjau">
              <button
                onClick={() => setPreviewOpen(true)}
                className="focus-ring flex h-9 w-9 items-center justify-center rounded-xl text-content-muted transition-colors hover:bg-border/15 hover:text-content"
                aria-label="Pratinjau"
              >
                <Eye className="h-[18px] w-[18px]" />
              </button>
            </Tooltip>
          )}
          {onDelete && (
            <Tooltip side="top" label="Hapus">
              <button
                onClick={() => onDelete(artifact.id)}
                className="focus-ring flex h-9 w-9 items-center justify-center rounded-xl text-content-muted transition-colors hover:bg-error/10 hover:text-error"
                aria-label="Hapus"
              >
                <Trash2 className="h-[18px] w-[18px]" />
              </button>
            </Tooltip>
          )}
          <button
            onClick={() => void handleDownload()}
            disabled={!artifact.url || downloading}
            className="btn-primary ml-1 flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-medium disabled:opacity-40"
            aria-label={`Unduh ${artifact.name}`}
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Unduh</span>
          </button>
        </div>
      </m.div>

      {/* Preview modal */}
      <AnimatePresence>
        {previewOpen && artifact.url && (
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="scrim fixed inset-0 z-[90] flex items-center justify-center p-4"
            onClick={() => setPreviewOpen(false)}
          >
            <m.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border/20 bg-surface-overlay shadow-float"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-border/15 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                      tile,
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <p className="truncate text-sm font-medium text-content">{artifact.name}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => void handleDownload()}
                    disabled={downloading}
                    className="btn-ghost flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium disabled:opacity-40"
                    aria-label="Unduh"
                  >
                    <Download className="h-3.5 w-3.5" /> Unduh
                  </button>
                  <button
                    onClick={() => setPreviewOpen(false)}
                    className="btn-ghost h-8 w-8 rounded-lg"
                    aria-label="Tutup pratinjau"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="scrollbar-thin flex-1 overflow-auto bg-surface-mid/30">
                {artifact.kind === 'html' ? (
                  // `sandbox` is mandatory here: this is model-authored HTML, and
                  // for a persisted artifact the signed URL is served from the
                  // Supabase project origin. Without it, scripts in the file could
                  // navigate the whole app away (phishing) or open popups.
                  // `allow-scripts` alone (never with `allow-same-origin`) keeps the
                  // preview functional while pinning the frame to an opaque origin.
                  <iframe
                    src={artifact.url}
                    sandbox="allow-scripts"
                    referrerPolicy="no-referrer"
                    className="h-[70vh] w-full border-0 bg-white"
                    title={artifact.name}
                  />
                ) : (
                  <pre className="whitespace-pre-wrap p-4 font-mono text-sm text-content">
                    {textPreview}
                  </pre>
                )}
              </div>
            </m.div>
          </m.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** Decode a data: URL body for text preview, tolerating non-base64 payloads. */
function decodePreview(url: string): string {
  const comma = url.indexOf(',');
  const meta = url.slice(0, comma);
  const body = url.slice(comma + 1);
  try {
    const raw = meta.includes(';base64') ? atob(body) : decodeURIComponent(body);
    // atob yields Latin-1; re-decode as UTF-8 so accents/emoji render correctly.
    return meta.includes(';base64')
      ? new TextDecoder().decode(Uint8Array.from(raw, (c) => c.charCodeAt(0)))
      : raw;
  } catch {
    return 'Pratinjau tidak tersedia untuk format ini.';
  }
}

/**
 * ArtifactPanel — collapsible panel showing all artifacts generated in a conversation.
 * Can be used inline in chat or as a side panel.
 */
export function ArtifactPanel({ artifacts, onDelete }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  // Clip only while the height animation runs; once settled we allow overflow
  // so action tooltips popping above a card aren't cut off by the wrapper.
  const [clip, setClip] = useState(false);
  const [freshUrls, setFreshUrls] = useState<Record<string, string>>({});
  /** Artifacts whose signed URL could not be renewed — their links are dead. */
  const [staleIds, setStaleIds] = useState<Set<string>>(new Set());

  // Persisted artifacts carry a signed URL that expires. Re-sign on every
  // render of this panel (i.e. every time the conversation is opened) so a
  // file generated days or weeks ago still downloads instead of 403ing.
  // Ephemeral (data: URL) artifacts are skipped — there's nothing in
  // Storage to re-sign for those.
  const refreshKey = artifacts
    .filter((a) => !a.ephemeral && a.bucket && a.storagePath)
    .map((a) => a.id)
    .join(',');

  useEffect(() => {
    if (!refreshKey) return;
    let cancelled = false;
    const controller = new AbortController();

    // Fire all URL refresh requests in parallel rather than serially — each
    // is an independent round-trip to /api/artifacts/refresh, so batching
    // them cuts the wait from N*RTT to 1*RTT.
    const refreshable = artifacts.filter((a) => !a.ephemeral && a.bucket && a.storagePath);
    if (refreshable.length === 0) return;

    Promise.allSettled(
      refreshable.map((a) =>
        fetch('/api/artifacts/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bucket: a.bucket, storagePath: a.storagePath }),
          signal: controller.signal,
        })
          .then((res) => (res.ok ? (res.json() as Promise<{ url?: string }>) : null))
          .then((data) => ({ id: a.id, url: data?.url })),
      ),
    ).then((results) => {
      if (cancelled) return;
      // A re-sign failure used to be swallowed twice over, leaving a stale URL
      // behind an enabled Download button that then 403'd with raw XML. Track
      // the failures so the card can say so.
      const failedIds = results
        .map((r, i) =>
          r.status === 'fulfilled' && r.value?.url ? null : (refreshable[i]?.id ?? null),
        )
        .filter((id): id is string => id !== null);
      if (failedIds.length > 0) {
        console.warn('[artifacts] Could not refresh signed URLs for:', failedIds.join(', '));
      }
      setStaleIds(new Set(failedIds));
      setFreshUrls((prev) => {
        const next = { ...prev };
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value?.url) {
            next[r.value.id] = r.value.url;
          }
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  if (artifacts.length === 0) return null;

  return (
    <div className="border-t border-border/15 bg-surface-mid/40">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-border/5"
        aria-expanded={!collapsed}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <File className="h-3.5 w-3.5" />
        </span>
        <span className="text-sm font-semibold text-content">Artifacts</span>
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-border/20 px-1.5 text-[0.7rem] font-semibold text-content-muted">
          {artifacts.length}
        </span>
        <span className="ml-auto">
          <ChevronDown
            className={cn(
              'h-4 w-4 text-content-subtle transition-transform',
              collapsed && '-rotate-90',
            )}
          />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <m.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            onAnimationStart={() => setClip(true)}
            onAnimationComplete={() => setClip(false)}
            className={cn(clip ? 'overflow-hidden' : 'overflow-visible')}
          >
            <div className="space-y-2 px-4 pb-4 pt-0.5">
              {artifacts.map((a) => (
                <ArtifactCard
                  key={a.id}
                  artifact={freshUrls[a.id] ? { ...a, url: freshUrls[a.id] } : a}
                  stale={staleIds.has(a.id)}
                  onDelete={onDelete}
                />
              ))}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export { ArtifactCard };
