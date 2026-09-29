import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Серый блок на месте того, что ещё грузится: форма будущего содержимого без текста. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-muted motion-reduce:animate-none', className)}
      {...props}
    />
  );
}
