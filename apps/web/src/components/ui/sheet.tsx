'use client';

import * as React from 'react';
import { cn } from 'cn';
import { Dialog as SheetPrimitive } from 'radix-ui';

/**
 * Выезжающая панель в духе shadcn/ui поверх Radix Dialog. Снизу — свойства редактора на узком
 * экране, слева — меню библиотеки. Сторона по умолчанию нижняя, чтобы редактор не менялся.
 */
function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-sm font-semibold', className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

/**
 * Панель. `bottom` прижата к низу: над ней остаётся видна часть слайда, сверху ручка.
 * `left` — на всю высоту, для меню, которое на широком экране и так стоит слева.
 */
function SheetContent({
  side = 'bottom',
  className,
  children,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: 'bottom' | 'left';
}) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        data-slot="sheet-overlay"
        className={cn(
          'fixed inset-0 z-[4500] bg-black/30',
          'data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
          'duration-150 motion-reduce:animate-none',
        )}
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'fixed z-[4500] flex flex-col bg-popover text-popover-foreground shadow-lg ring-1 ring-border outline-none',
          'data-open:animate-in data-closed:animate-out duration-200 motion-reduce:animate-none',
          side === 'bottom' &&
            'inset-x-0 bottom-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)] data-open:slide-in-from-bottom data-closed:slide-out-to-bottom',
          side === 'left' &&
            'inset-y-0 left-0 h-dvh w-64 max-w-[calc(100vw-2.5rem)] pl-[env(safe-area-inset-left)] data-open:slide-in-from-left data-closed:slide-out-to-left',
          className,
        )}
        {...props}
      >
        {side === 'bottom' ? (
          // Ручка сверху — знак того, что это панель поверх, а не страница.
          <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border" />
        ) : null}
        {children}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

export { Sheet, SheetContent, SheetDescription, SheetTitle };
