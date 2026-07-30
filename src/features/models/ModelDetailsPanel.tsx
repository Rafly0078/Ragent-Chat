'use client';

import { useEffect } from 'react';
import { Loader2, AlertCircle, Cpu, Eye, HardDrive, Hash, Layers, BookOpen, FileText } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { useModelDetails } from './use-model-details';
import type { ModelInfo } from '@/types';
import { formatBytes, formatNumber } from '@/lib/utils/format';


interface Props {
  open: boolean;
  onClose: () => void;
  model: ModelInfo | null;
}

export function ModelDetailsPanel({ open, onClose, model }: Props) {
  const { details, loading, error, fetchDetails } = useModelDetails();

  useEffect(() => {
    if (!open || !model?.name) return;
    const ctrl = new AbortController();
    fetchDetails(model.name, ctrl.signal);
    return () => ctrl.abort();
  }, [open, model?.name, fetchDetails]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={model?.label ?? 'Model Details'}
      description="Detailed information about the selected model."
    >
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-error/30 bg-error/5 p-3 text-sm text-error">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && details && (
        <div className="space-y-4">
          {/* Quick stats */}
          <div className="grid grid-cols-2 gap-3">
            <DetailCard
              icon={<Cpu className="h-4 w-4 text-accent" />}
              label="Family"
              value={details.family?.join(', ') || model?.details.family || 'Unknown'}
            />
            <DetailCard
              icon={<Layers className="h-4 w-4 text-accent" />}
              label="Parameters"
              value={details.parameter_size || model?.details.parameterSize || '—'}
            />
            <DetailCard
              icon={<HardDrive className="h-4 w-4 text-accent" />}
              label="Quantization"
              value={details.quantization_level || model?.details.quantizationLevel || '—'}
            />
            <DetailCard
              icon={<Hash className="h-4 w-4 text-accent" />}
              label="Size"
              value={model?.size ? formatBytes(model.size) : '—'}
            />
          </div>

          {/* Context length */}
          {model?.contextLength && (
            <div className="rounded-xl border-2 border-border bg-surface-raised p-3 shadow-subtle">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-accent" />
                <span className="text-sm font-medium text-content">Context Length</span>
              </div>
              <p className="mt-1 text-lg font-bold tabular-nums text-content">
                {formatNumber(model.contextLength)} tokens
              </p>
            </div>
          )}

          {/* Capabilities */}
          {details.capabilities && details.capabilities.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-content-muted uppercase tracking-wide">Capabilities</p>
              <div className="flex flex-wrap gap-2">
                {details.capabilities.map((cap) => (
                  <span
                    key={cap}
                    className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-1 text-xs font-medium text-accent"
                  >
                    {cap === 'vision' && <Eye className="h-3 w-3" />}
                    {cap}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Parameters string */}
          {details.parameters && (
            <div>
              <p className="mb-2 text-xs font-medium text-content-muted uppercase tracking-wide">Generation Parameters</p>
              <pre className="scrollbar-thin max-h-40 overflow-auto rounded-xl border-2 border-border bg-[rgb(0_0_58_/_0.5)] p-3 font-mono text-xs text-content-subtle">
                {details.parameters}
              </pre>
            </div>
          )}

          {/* Template */}
          {details.template && (
            <div>
              <p className="mb-2 text-xs font-medium text-content-muted uppercase tracking-wide">Template</p>
              <pre className="scrollbar-thin max-h-40 overflow-auto rounded-xl border-2 border-border bg-[rgb(0_0_58_/_0.5)] p-3 font-mono text-xs text-content-subtle">
                {details.template}
              </pre>
            </div>
          )}

          {/* License */}
          {details.license && (
            <div>
              <p className="mb-2 text-xs font-medium text-content-muted uppercase tracking-wide">License</p>
              <p className="rounded-xl border-2 border-border bg-surface-raised p-3 text-xs text-content-muted leading-relaxed">
                {details.license.slice(0, 500)}{details.license.length > 500 ? '…' : ''}
              </p>
            </div>
          )}

          {/* Model name */}
          <div className="rounded-xl border border-border bg-border/5 p-2">
            <p className="text-[0.7rem] text-content-subtle">
              <FileText className="mr-1 inline h-3 w-3" />
              Full name: <code className="font-mono text-accent-soft">{details.name}</code>
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}

function DetailCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border-2 border-border bg-surface-raised p-3 shadow-subtle">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs font-medium text-content-muted uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-1 truncate text-sm font-bold text-content">{value}</p>
    </div>
  );
}
