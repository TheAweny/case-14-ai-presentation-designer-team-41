/** Прямоугольник в координатах экрана, как у `getBoundingClientRect`. */
export interface ScreenRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** К какому краю холста прижата рейка инструментов. */
export type RailSide = 'left' | 'right' | 'top' | 'bottom';

/**
 * Где полосе можно стоять: видимая область холста без рейки инструментов. Рейка плавает
 * поверх холста у одного из краёв, и полоса, сдвинутая к этому краю, не должна на неё лечь.
 */
export function barBounds(
  area: ScreenRect,
  rail: { readonly rect: ScreenRect; readonly side: RailSide } | null,
): ScreenRect {
  if (!rail) return area;
  const { rect, side } = rail;
  // Поля по одному: у `DOMRect` они на прототипе, и `{ ...rect }` дал бы пустой объект.
  const bounds = { left: area.left, top: area.top, right: area.right, bottom: area.bottom };
  if (side === 'left') bounds.left = Math.max(area.left, rect.right);
  if (side === 'right') bounds.right = Math.min(area.right, rect.left);
  if (side === 'top') bounds.top = Math.max(area.top, rect.bottom);
  if (side === 'bottom') bounds.bottom = Math.min(area.bottom, rect.top);
  // Рейка на весь холст (узкое окно) — лучше встать поверх неё, чем исчезнуть.
  return bounds.right > bounds.left && bounds.bottom > bounds.top ? bounds : area;
}

/** Меньше этого по вертикали — одна строка: у концов выделения на одной строке разный `top`. */
const SAME_LINE = 2;

/**
 * К чему крепится полоса формата. Полоса встаёт над якорем, а если сверху нет места — под
 * ним, поэтому якорь накрывает всё, что полосе закрывать нельзя.
 *
 * По вертикали якорь — вся рамка: полоса стоит над текстом, не закрывает ни одной его строки и
 * не прыгает за кареткой, пока печатают. По горизонтали — выделенный кусок, если он в одной
 * строке (полоса встаёт над словом, как у Google Docs), иначе — ширина рамки.
 *
 * Если верх рамки ушёл за край видимой области (рамка выше холста при крупном зуме), якорь —
 * выделенные строки или строка с кареткой: так полоса остаётся на экране у того, что правят.
 *
 * `from` и `to` — `coordsAtPos` концов выделения, `frame` — рамка поля, `visibleTop` — верх
 * видимой области, `room` — сколько места нужно полосе над якорем.
 */
export function formatBarAnchor({
  frame,
  from,
  to,
  empty,
  visibleTop,
  room,
}: {
  frame: ScreenRect;
  from: ScreenRect;
  to: ScreenRect;
  empty: boolean;
  visibleTop: number;
  room: number;
}): ScreenRect {
  const oneLine = !empty && Math.abs(from.top - to.top) < SAME_LINE;
  const left = oneLine ? Math.min(from.left, to.left) : frame.left;
  const right = oneLine ? Math.max(from.right, to.right) : frame.right;
  if (frame.top - room >= visibleTop) {
    return { left, right, top: frame.top, bottom: frame.bottom };
  }
  return {
    left,
    right,
    top: Math.min(from.top, to.top),
    bottom: Math.max(from.bottom, to.bottom),
  };
}
