import { useMemo, useRef, type MouseEvent } from 'react';

/**
 * Кнопки вокруг холста — рейка, масштаб, кнопки панелей — не забирают фокус с мыши.
 * Иначе после клика фокус оставался бы на кнопке, и пробел нажимал бы её вместо того,
 * чтобы включить руку. С клавиатуры кнопки по-прежнему получают фокус как обычно.
 */
export function keepCanvasFocus(event: MouseEvent<HTMLElement>): void {
  event.preventDefault();
}

/**
 * То же для меню Radix: открытое мышью меню после закрытия не возвращает фокус на кнопку,
 * открытое с клавиатуры — возвращает, чтобы Tab продолжил с того же места.
 *
 * `trigger` — обработчики для кнопки меню, `onCloseAutoFocus` — для его содержимого.
 */
export function useMenuFocus() {
  const byPointer = useRef(false);
  return useMemo(
    () => ({
      trigger: {
        onPointerDown: () => {
          byPointer.current = true;
        },
        onKeyDown: () => {
          byPointer.current = false;
        },
      },
      onCloseAutoFocus: (event: Event) => {
        if (byPointer.current) event.preventDefault();
      },
    }),
    [],
  );
}
