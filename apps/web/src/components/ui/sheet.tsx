'use client';

import * as React from 'react';
import { cn } from 'cn';
import { Dialog as SheetPrimitive } from 'radix-ui';

/**
 * Выезжающая панель в духе shadcn/ui поверх Radix Dialog. Пока нужна только нижняя — панель
 * свойств на узком экране, — поэтому стороны другой нет: добавится, когда понадобится.
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

/** Нижняя панель: прижата к низу экрана, над ней остаётся видна часть слайда. */
function SheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content>) {
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
          'fixed inset-x-0 bottom-0 z-[4500] flex flex-col rounded-t-2xl bg-popover',
          'text-popover-foreground shadow-lg ring-1 ring-border outline-none',
          'pb-[env(safe-area-inset-bottom)]',
          'data-open:animate-in data-open:slide-in-from-bottom',
          'data-closed:animate-out data-closed:slide-out-to-bottom',
          'duration-200 motion-reduce:animate-none',
          className,
        )}
        {...props}
      >
        {/* Ручка сверху — знак того, что это панель поверх, а не страница. */}
        <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border" />
        {children}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

export { Sheet, SheetContent, SheetDescription, SheetTitle };
