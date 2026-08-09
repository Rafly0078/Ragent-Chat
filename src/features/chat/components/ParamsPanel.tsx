'use client';

import type { GenerationParams } from '@/types';
import { Modal } from '@/components/ui/modal';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { DEFAULT_PARAMS } from '@/lib/store/defaults';
import { limitSourceLabel, resolveLimits } from '@/features/models/resolve-limits';
import { cn } from '@/lib/utils/cn';

interface Props {
  open: boolean;
  onClose: () => void;
  params: GenerationParams;
  onChange: (patch: Partial<GenerationParams>) => void;
  /** Active model — decides what "auto" resolves the two limits to. */
  model: string;
}

/** Fallback slider ceiling when nothing is known about the model. */
const FALLBACK_MAX = 131_072;

/** Generation parameter editor: temperature, top_p, top_k, repeat penalty, ctx, max tokens. */
export function ParamsPanel({ open, onClose, params, onChange, model }: Props) {
  const limits = resolveLimits(params, model);

  // Slider ceilings track the detected limit so a 1M-token model isn't capped at
  // the old hardcoded 131072 the moment someone switches to manual.
  const contextMax = Math.max(limits.contextLength, params.contextLength, FALLBACK_MAX);
  const maxTokensMax = Math.max(limits.maxTokens, params.maxTokens, FALLBACK_MAX);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generation parameters"
      description="These apply to this conversation. Set global defaults in Settings."
      footer={
        <>
          <Button variant="ghost" onClick={() => onChange(DEFAULT_PARAMS)}>
            Reset to defaults
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <Slider
          label="Temperature"
          hint="creativity"
          value={params.temperature}
          min={0}
          max={2}
          step={0.05}
          onChange={(v) => onChange({ temperature: v })}
          format={(v) => v.toFixed(2)}
        />
        <Slider
          label="Top P"
          hint="nucleus sampling"
          value={params.topP}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ topP: v })}
          format={(v) => v.toFixed(2)}
        />
        <Slider
          label="Top K"
          hint="token pool"
          value={params.topK}
          min={0}
          max={100}
          step={1}
          onChange={(v) => onChange({ topK: v })}
        />
        <Slider
          label="Repeat penalty"
          hint="discourage repetition"
          value={params.repeatPenalty}
          min={0.8}
          max={2}
          step={0.01}
          onChange={(v) => onChange({ repeatPenalty: v })}
          format={(v) => v.toFixed(2)}
        />

        <AutoLimitField
          label="Context length"
          hint="num_ctx"
          auto={params.contextAuto !== false}
          // Auto can be *on* and still resolve nothing (an unlabeled custom
          // endpoint). Saying "following the model" there would be a lie, so the
          // field falls back to showing the stored number as the one in use.
          resolved={limits.contextAuto ? limits.contextLength : null}
          note={limitSourceLabel(limits.contextSource)}
          value={params.contextLength}
          min={512}
          max={contextMax}
          step={512}
          onAutoChange={(contextAuto) => onChange({ contextAuto })}
          onChange={(contextLength) => onChange({ contextLength, contextAuto: false })}
        />

        <AutoLimitField
          label="Max tokens"
          hint="num_predict (-1 = unlimited)"
          auto={params.maxTokensAuto !== false}
          resolved={limits.maxTokensAuto ? limits.maxTokens : null}
          note="the model's output ceiling"
          value={params.maxTokens}
          min={-1}
          max={maxTokensMax}
          step={1}
          onAutoChange={(maxTokensAuto) => onChange({ maxTokensAuto })}
          onChange={(maxTokens) => onChange({ maxTokens, maxTokensAuto: false })}
        />
      </div>
    </Modal>
  );
}

/**
 * A limit that can either follow the model or be pinned by hand.
 *
 * Auto is the default, so the common case is a read-only line stating the number
 * in use and where it came from. Turning auto off reveals the slider; touching
 * the slider is itself an opt-out (the caller sets the flag false), because
 * dragging a control and having the value snap back is the worse surprise.
 */
function AutoLimitField({
  label,
  hint,
  auto,
  resolved,
  note,
  value,
  min,
  max,
  step,
  onAutoChange,
  onChange,
}: {
  label: string;
  hint: string;
  auto: boolean;
  resolved: number | null;
  note: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onAutoChange: (auto: boolean) => void;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-medium text-content">{label}</label>
        <div className="flex shrink-0 items-center rounded-lg border border-border/20 p-0.5">
          {[true, false].map((isAuto) => (
            <button
              key={String(isAuto)}
              type="button"
              aria-pressed={auto === isAuto}
              onClick={() => onAutoChange(isAuto)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                auto === isAuto
                  ? 'bg-accent text-accent-fg'
                  : 'text-content-muted hover:text-content',
              )}
            >
              {isAuto ? 'Auto' : 'Manual'}
            </button>
          ))}
        </div>
      </div>

      {auto ? (
        <div className="rounded-lg border border-border/15 bg-border/5 px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm tabular-nums text-content">
              {resolved == null ? value.toLocaleString() : resolved.toLocaleString()}
            </span>
            <span className="text-xs text-content-muted">{hint}</span>
          </div>
          <p className="mt-1 text-xs text-content-subtle">
            {resolved == null
              ? 'This endpoint reports no limit — using the stored value.'
              : `Following the model — ${note}.`}
          </p>
        </div>
      ) : (
        <Slider
          hideLabel
          label={label}
          hint={hint}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={onChange}
        />
      )}
    </div>
  );
}
