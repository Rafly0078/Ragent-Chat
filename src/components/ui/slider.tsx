'use client';

import { cn } from '@/lib/utils/cn';

/** Labeled range slider with live value + numeric input for precision. */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  hint,
  format = (v) => String(v),
  hideLabel = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  hint?: string;
  format?: (v: number) => string;
  /** Drop the visible label when the caller already renders one above the
   *  slider; `label` is still used for the accessible names. */
  hideLabel?: boolean;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-2">
      <div className={cn('flex items-center', hideLabel ? 'justify-end' : 'justify-between')}>
        {!hideLabel && <label className="text-sm font-medium text-content">{label}</label>}
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(clamp(Number(e.target.value), min, max))}
          // 16px on touch so focusing it doesn't trigger iOS zoom (the box grows
          // to h-9 to fit); back to the dense 28px/12px chip on pointer devices.
          className="input h-9 w-24 px-2 py-0 text-right tabular-nums [@media(hover:hover)]:h-7 [@media(hover:hover)]:w-20 [@media(hover:hover)]:text-xs"
          aria-label={`${label} value`}
        />
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className={cn(
          'h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none',
          '[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-subtle [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110',
          '[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-accent',
        )}
        style={{
          background: `linear-gradient(to right, rgb(var(--accent)) ${pct}%, rgb(var(--content-subtle) / 0.25) ${pct}%)`,
        }}
      />
      <div className="flex justify-between text-xs text-content-subtle">
        <span>{format(min)}</span>
        {hint && <span className="text-content-muted">{hint}</span>}
        <span>{format(max)}</span>
      </div>
    </div>
  );
}

function clamp(v: number, min: number, max: number) {
  if (Number.isNaN(v)) return min;
  return Math.min(max, Math.max(min, v));
}
