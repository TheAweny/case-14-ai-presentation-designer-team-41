'use client';

import * as React from 'react';
import { cn } from 'cn';
import { Slider as SliderPrimitive } from 'radix-ui';

/** Ползунок на radix-ui: дорожка, заполненная часть и ручка с мягким ореолом на фокусе. */
function Slider({ className, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const thumbs = (props.value ?? props.defaultValue ?? [0]).length;
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        'relative flex h-5 w-full touch-none items-center select-none data-disabled:opacity-40',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1 grow overflow-hidden rounded-full bg-muted">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-foreground" />
      </SliderPrimitive.Track>
      {Array.from({ length: thumbs }, (_, index) => (
        <SliderPrimitive.Thumb
          key={index}
          className={cn(
            'block size-4 rounded-full bg-foreground shadow-sm outline-none',
            'ring-4 ring-foreground/10 transition-[box-shadow] duration-150 motion-reduce:transition-none',
            'hover:ring-6 focus-visible:ring-6 focus-visible:ring-foreground/20',
            'data-disabled:pointer-events-none',
          )}
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
