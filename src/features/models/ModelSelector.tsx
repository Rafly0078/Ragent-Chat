'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import {
  Check,
  ChevronDown,
  Cpu,
  Eye,
  Info,
  Lock,
  Pencil,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import type { ModelInfo } from '@/types';
import { useModels } from './use-models';
import { ModelDetailsPanel } from './ModelDetailsPanel';
import { ModelLabelEditor } from './ModelLabelEditor';
import { formatBytes, formatNumber } from '@/lib/utils/format';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/cn';
import { getApiProvider } from '@/lib/api/config';
import { useSettings } from '@/lib/store/settings-store';

interface Props {
  value: string;
  onChange: (model: string) => void;
}

export function ModelSelector({ value, onChange }: Props) {
  const { models, loading, error, isOwner, reload } = useModels();
  const provider = useSettings((s) => s.apiProvider);
  const [open, setOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsModel, setDetailsModel] = useState<ModelInfo | null>(null);
  const [editModel, setEditModel] = useState<ModelInfo | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Auto-select the first model once loaded if none is set.
  useEffect(() => {
    if (models.length > 0 && models[0] && !models.some((model) => model.name === value)) {
      onChange(models[0].name);
    }
  }, [value, models, onChange]);

  const active = models.find((m) => m.name === value);
  const showOllamaDetails = getApiProvider() === 'ollama';
  // The built-in provider is pinned to one server-chosen model, so there is
  // nothing to pick. Render a plain label instead of a dropdown that can only
  // ever reselect what is already active. `providerChat` enforces this too —
  // this is the visible half of a lock that does not depend on the client.
  const locked = provider === 'default';

  if (locked) {
    return (
      <Tooltip label="This deployment is locked to one model" side="bottom">
        <span className="btn-surface h-9 max-w-[60vw] cursor-default gap-2 px-3 sm:max-w-xs">
          <Cpu className="h-4 w-4 shrink-0 text-accent" />
          <span className="truncate font-medium">
            {active ? active.label : loading ? 'Loading…' : value || 'Default model'}
          </span>
          {active?.supportsVision && <Eye className="h-3.5 w-3.5 shrink-0 text-accent-soft" />}
          <Lock className="h-3.5 w-3.5 shrink-0 text-content-subtle" />
        </span>
      </Tooltip>
    );
  }

  return (
    <div ref={ref} className="relative">
      <ModelDetailsPanel
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        model={detailsModel}
      />
      <ModelLabelEditor
        open={Boolean(editModel)}
        model={editModel}
        onClose={() => setEditModel(null)}
        onSaved={reload}
      />
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn-surface h-9 max-w-[60vw] gap-2 px-3 sm:max-w-xs"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Cpu className="h-4 w-4 shrink-0 text-accent" />
        <span className="truncate font-medium">
          {active ? active.label : loading ? 'Loading…' : value || 'Select model'}
        </span>
        {active?.supportsVision && <Eye className="h-3.5 w-3.5 shrink-0 text-accent-soft" />}
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>

      <AnimatePresence>
        {open && (
          <m.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            role="listbox"
            className="popover scrollbar-thin absolute left-0 top-full z-50 mt-2 max-h-[70vh] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto p-1.5"
          >
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-xs font-medium text-content-muted">
                {models.length} model{models.length === 1 ? '' : 's'}
              </span>
              <button
                onClick={reload}
                className="rounded-md p-1 text-content-subtle hover:text-content"
                aria-label="Reload models"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              </button>
            </div>

            {loading && (
              <div className="space-y-1.5 p-1.5">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-xl" />
                ))}
              </div>
            )}

            {error && !loading && (
              <div className="flex items-start gap-2 p-3 text-sm text-warning">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p>{error}</p>
                  <button onClick={reload} className="mt-1 text-xs text-accent hover:underline">
                    Try again
                  </button>
                </div>
              </div>
            )}

            {!loading && !error && models.length === 0 && (
              <p className="p-3 text-sm text-content-muted">
                {showOllamaDetails
                  ? 'No Ollama models found.'
                  : 'No models returned. Add a manual model ID in Settings.'}
              </p>
            )}

            {models.map((model) => (
              <ModelRow
                key={model.name}
                model={model}
                selected={model.name === value}
                canEdit={isOwner}
                showDetails={showOllamaDetails}
                onSelect={() => {
                  onChange(model.name);
                  setOpen(false);
                }}
                onDetails={() => {
                  setDetailsModel(model);
                  setDetailsOpen(true);
                  setOpen(false);
                }}
                onEdit={() => {
                  setEditModel(model);
                  setOpen(false);
                }}
              />
            ))}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ModelRow({
  model,
  selected,
  canEdit,
  showDetails,
  onSelect,
  onDetails,
  onEdit,
}: {
  model: ModelInfo;
  selected: boolean;
  canEdit: boolean;
  showDetails: boolean;
  onSelect: () => void;
  onDetails: () => void;
  onEdit: () => void;
}) {
  const chips = [
    model.details.parameterSize,
    model.details.quantizationLevel,
    model.details.family,
    model.size ? formatBytes(model.size) : undefined,
    model.contextLength ? `${formatNumber(model.contextLength)} ctx` : undefined,
  ].filter(Boolean) as string[];

  return (
    <button
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-border/5',
        selected && 'bg-accent/10',
      )}
    >
      <div className="mt-0.5 h-4 w-4 shrink-0">
        {selected && <Check className="h-4 w-4 text-accent" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium text-content">{model.label}</span>
          {model.supportsVision && <Eye className="h-3.5 w-3.5 shrink-0 text-accent-soft" />}
        </div>
        {model.description && (
          <p className="mt-0.5 truncate text-xs text-content-muted">{model.description}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {chips.map((c, i) => (
            <span
              key={i}
              className="rounded-md bg-border/5 px-1.5 py-0.5 text-[0.68rem] tabular-nums text-content-subtle"
            >
              {c}
            </span>
          ))}
          {showDetails && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDetails();
              }}
              className="rounded-md p-0.5 text-content-subtle hover:text-accent"
              aria-label="Model details"
            >
              <Info className="h-3 w-3" />
            </button>
          )}
          {canEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="rounded-md p-0.5 text-content-subtle hover:text-accent"
              aria-label="Rename model"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </button>
  );
}
