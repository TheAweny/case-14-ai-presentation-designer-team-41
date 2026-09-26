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

/**
 * Метка интерфейса поверх холста: полоса свойств, полоса формата текста и их выпадашки. Клик
 * сюда — не клик по слайду: он не начинает рамку выделения, не закрывает набор и не
 * снимает выделение.
 */
export const EDITOR_CHROME = '[data-editor-chrome]';

/** Событие пришло из интерфейса поверх холста, а не со слайда. */
export function isEditorChrome(target: EventTarget | null): boolean {
  const closest = (target as { closest?: unknown } | null)?.closest;
  return (
    typeof closest === 'function' &&
    (closest as (selector: string) => unknown).call(target, EDITOR_CHROME) !== null
  );
}

/**
 * Нажатие мышью на кнопки полосы не забирает фокус (у набора текста — его выделение, у холста —
 * пробел для руки), а в поле ввода — забирает, иначе туда не напечатать.
 *
 * Выпадашки Radix живут в портале, но React доносит их события по дереву компонентов до
 * полосы. Их не трогаем: поиск шрифта и HEX в поповере должны получать фокус.
 */
export function keepFocusOnPress(event: MouseEvent<HTMLElement>): void {
  const target = event.target;
  if (!(target instanceof Node) || !event.currentTarget.contains(target)) return;
  if (target instanceof Element && target.closest('input, textarea, select')) return;
  event.preventDefault();
}

/**
 * Правая кнопка на полосе и в её меню. Без этого React донёс бы событие из портала до холста,
 * и тот снял бы выделение и открыл своё меню поверх полосы. В поле ввода остаётся системное
 * меню: там вставляют и копируют.
 */
export function stopCanvasMenu(event: MouseEvent<HTMLElement>): void {
  event.stopPropagation();
  const target = event.target;
  if (target instanceof Element && target.closest('input, textarea')) return;
  event.preventDefault();
}
