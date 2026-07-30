'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils/cn';

type Variant = 'primary' | 'ghost' | 'surface' | 'danger';
type Size = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  primary: 'btn-primary',
  ghost: 'btn-ghost',
  surface: 'btn-surface',
  danger: 'btn-destructive',
};

/**
 * Sizes map onto the `.btn-*` scale in globals.css instead of restating heights
 * and padding here. Before this, a `<Button size="md">` was 40px and a
 * hand-written `.btn-ghost .btn-md` was 36px, so the same nominal size rendered
 * two different buttons depending on which one a caller reached for.
 */
const sizes: Record<Size, string> = {
  sm: 'btn-sm',
  md: 'btn-md',
  lg: 'btn-lg',
  icon: 'btn-md btn-icon',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'surface', size = 'md', ...props }, ref) => (
    <button ref={ref} className={cn(variants[variant], sizes[size], className)} {...props} />
  ),
);
Button.displayName = 'Button';
