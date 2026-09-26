'use client';

import * as React from 'react';
import { cn } from 'cn';
import { Tooltip as TooltipPrimitive } from 'radix-ui';

/**
 * Провайдер задаёт паузу перед первой подсказкой. Пока одна подсказка открыта, соседние
 * показываются сразу — как у кнопок рейки.
 */
function TooltipProvider({
  delayDuration = 260,
  skipDelayDuration = 300,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      {...props}
    />
  );
}

function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger(props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

/** Вид — тот же, что у подсказок рейки: название и клавиши в одну строку. */
function TooltipContent({
  className,
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'z-[5000] flex w-max items-center gap-1.5 rounded-md bg-popover px-2 py-1',
          'text-[11px] leading-none font-medium text-popover-foreground',
          'shadow-md ring-1 shadow-black/40 ring-border',
          'animate-in fade-in-0 duration-100 motion-reduce:animate-none',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
