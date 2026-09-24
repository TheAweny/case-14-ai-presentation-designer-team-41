import * as React from 'react';
import { cn } from 'cn';

/** Клавиша в подсказке: одна на каждую часть сочетания. */
function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'rounded-sm bg-muted px-1.5 py-0.5 font-sans text-[0.625rem] leading-none text-muted-foreground ring-1 ring-border',
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
