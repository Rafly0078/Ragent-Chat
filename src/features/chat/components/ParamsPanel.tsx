'use client';

import type { GenerationParams } from '@/types';
import { Modal } from '@/components/ui/modal';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { DEFAULT_PARAMS } from '@/lib/store/defaults';

interface Props {
  open: boolean;
  onClose: () => void;
  params: GenerationParams;
  onChange: (patch: Partial<GenerationParams>) => void;
}

/** Generation parameter editor: temperature, top_p, top_k, repeat penalty, ctx, max tokens. */
export function ParamsPanel({ open, onClose, params, onChange }: Props) {
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
        <Slider
          label="Context length"
          hint="num_ctx"
          value={params.contextLength}
          min={512}
          max={131072}
          step={512}
          onChange={(v) => onChange({ contextLength: v })}
        />
        <Slider
          label="Max tokens"
          hint="num_predict (-1 = auto)"
          value={params.maxTokens}
          min={-1}
          max={131072}
          step={1}
          onChange={(v) => onChange({ maxTokens: v })}
        />
      </div>
    </Modal>
  );
}
