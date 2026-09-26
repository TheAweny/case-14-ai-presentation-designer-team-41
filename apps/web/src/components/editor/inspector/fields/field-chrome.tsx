'use client';

import { useRef, type ComponentProps } from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

/** Корпус поля панели: серая плашка 28 px, при наведении — рамка, при фокусе — светлый фон. */
export const FIELD_CLASS = cn(
  'group/field flex h-7 min-w-0 items-center gap-1.5 rounded-md bg-muted/60 px-2 text-xs',
  'ring-1 ring-transparent transition-colors duration-100 motion-reduce:transition-none',
  'hover:ring-border focus-within:bg-background focus-within:ring-ring',
);

/** Выпадающие части полей: тот же вид, что у меню редактора. */
export const POPOVER_CLASS = cn(
  'z-[5000] rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10',
  'outline-none duration-100 data-[state=open]:animate-in data-[state=open]:fade-in-0',
  'data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
  'data-[state=closed]:zoom-out-95',
  'motion-reduce:animate-none',
);

/**
 * Фокус вокруг выпадашки поля.
 *
 * Панель правит и выделенный фрагмент в открытом наборе текста, поэтому нажатие мышью на
 * кнопку поля фокус не забирает, а после закрытия он возвращается туда, где был (в набор —
 * с тем же выделением). Открытие с клавиатуры работает как обычно: фокус уходит внутрь и
 * возвращается на кнопку. Щелчок мимо выпадашки фокус не трогает — он уже там, куда щёлкнули.
 */
export function useFocusReturn({ focusOnOpen }: { focusOnOpen: boolean }) {
  const byPointer = useRef(false);
  const previous = useRef<Element | null>(null);
  const outside = useRef(false);

  const trigger = {
    onPointerDownCapture: () => {
      byPointer.current = true;
      previous.current = document.activeElement;
    },
    onKeyDownCapture: () => {
      byPointer.current = false;
    },
    onMouseDown: (event: { preventDefault(): void }) => event.preventDefault(),
  };

  const content = {
    onOpenAutoFocus: (event: Event) => {
      outside.current = false;
      if (byPointer.current && !focusOnOpen) event.preventDefault();
    },
    onInteractOutside: () => {
      outside.current = true;
    },
    onCloseAutoFocus: (event: Event) => {
      if (!byPointer.current) return;
      event.preventDefault();
      byPointer.current = false;
      const target = previous.current;
      previous.current = null;
      if (outside.current) return;
      if (target instanceof HTMLElement && target.isConnected && target !== document.body) {
        target.focus({ preventScroll: true });
      }
    },
  };

  return { trigger, content };
}

/**
 * Содержимое поповера поля. `data-inspector-popover` — метка для набора текста: фокус здесь
 * набор не закрывает.
 */
export function FieldPopoverContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-inspector-popover=""
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(POPOVER_CLASS, className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
