/*
 * Несколько слайдов в списке — как в Google Slides и PowerPoint: щелчок выбирает один, Ctrl
 * (Cmd) добавляет или снимает, Shift — диапазон от якоря. Открытый слайд всегда среди
 * выбранных; выбор хранится id слайдов, поэтому переживает перестановку.
 */

/** Как щёлкнули по миниатюре. */
export interface PickModifiers {
  /** Shift: диапазон от якоря. */
  readonly range: boolean;
  /** Ctrl или Cmd: добавить или снять один. */
  readonly toggle: boolean;
}

export interface SlidePick {
  /** Выбранные слайды, в порядке колоды. */
  readonly picked: readonly string[];
  /** Какой слайд открыть. */
  readonly open: string;
  /** От какого слайда считать следующий диапазон. */
  readonly anchor: string;
}

function inDeckOrder(order: readonly string[], ids: Iterable<string>): string[] {
  const wanted = new Set(ids);
  return order.filter((id) => wanted.has(id));
}

/**
 * Выбор после щелчка по слайду `id`. Снять последний выбранный нельзя: открытый слайд
 * всегда выбран. Снятый открытый слайд уступает место ближайшему выбранному.
 */
export function pickSlide(
  order: readonly string[],
  state: { readonly picked: readonly string[]; readonly anchor: string | null },
  id: string,
  modifiers: PickModifiers,
): SlidePick {
  const at = order.indexOf(id);
  if (modifiers.range) {
    const anchor = state.anchor !== null && order.includes(state.anchor) ? state.anchor : id;
    const from = order.indexOf(anchor);
    const [start, end] = from <= at ? [from, at] : [at, from];
    return { picked: order.slice(start, end + 1), open: id, anchor };
  }
  if (modifiers.toggle) {
    if (!state.picked.includes(id)) {
      return { picked: inDeckOrder(order, [...state.picked, id]), open: id, anchor: id };
    }
    const rest = state.picked.filter((item) => item !== id);
    if (rest.length === 0) return { picked: [id], open: id, anchor: id };
    // Ближайший выбранный за снятым, а если за ним никого — перед ним.
    const next =
      order.slice(at + 1).find((item) => rest.includes(item)) ??
      order
        .slice(0, at)
        .reverse()
        .find((item) => rest.includes(item)) ??
      rest[0] ??
      id;
    return { picked: inDeckOrder(order, rest), open: next, anchor: next };
  }
  return { picked: [id], open: id, anchor: id };
}

/**
 * Где встанет перетаскиваемый блок: позиция среди остальных слайдов для `commitMoveSlides`.
 * Вниз — после слайда, над которым отпустили, вверх — перед ним. `null` — отпустили на
 * одном из перетаскиваемых, и порядок не меняется.
 */
export function blockDropIndex(
  order: readonly string[],
  moving: readonly string[],
  activeId: string,
  overId: string,
): number | null {
  if (moving.includes(overId)) return null;
  const staying = order.filter((id) => !moving.includes(id));
  const over = staying.indexOf(overId);
  if (over < 0) return null;
  const down = order.indexOf(activeId) < order.indexOf(overId);
  return down ? over + 1 : over;
}
