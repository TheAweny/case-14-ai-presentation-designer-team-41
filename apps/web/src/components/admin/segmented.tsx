'use client';

import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

/**
 * Короткий выбор сегментами. Повторное нажатие на выбранный сегмент Radix снимает,
 * а у нас значение есть всегда — пустой ответ игнорируется.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: readonly { id: T; label: string }[];
  disabled?: boolean;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      aria-label={label}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const option = options.find((candidate) => candidate.id === next);
        if (option) onChange(option.id);
      }}
      className={cn('flex max-w-full flex-wrap rounded-lg bg-muted p-0.5', className)}
    >
      {options.map((option) => (
        <ToggleGroupPrimitive.Item
          key={option.id}
          value={option.id}
          className={cn(
            'min-h-11 min-w-11 flex-1 rounded-md px-2.5 text-sm text-muted-foreground outline-none',
            'transition-colors duration-150 motion-reduce:transition-none',
            'hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
            'data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm',
            'md:min-h-8',
          )}
        >
          {option.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}
