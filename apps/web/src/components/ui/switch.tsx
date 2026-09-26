'use client';

import * as React from 'react';
import { cn } from 'cn';
import { Switch as SwitchPrimitive } from 'radix-ui';

/** Переключатель на radix-ui. Включённый окрашен цветом текста — как остальные акценты оболочки. */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'inline-flex h-4.5 w-7.5 shrink-0 items-center rounded-full bg-muted p-0.5 outline-none',
        'transition-colors duration-150 motion-reduce:transition-none',
        'focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=checked]:bg-foreground',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'block size-3.5 rounded-full bg-foreground transition-transform duration-150 motion-reduce:transition-none',
          'data-[state=checked]:translate-x-3 data-[state=checked]:bg-background',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
