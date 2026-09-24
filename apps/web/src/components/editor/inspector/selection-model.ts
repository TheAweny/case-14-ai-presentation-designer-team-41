import type { Box, SlideElement } from '@lct/contracts';
import { EMU_PER_PT } from '@lct/slide-renderer';
import type { Alignment } from '@/components/editor/slide-geometry';
import type { ElementMove } from '@/components/editor/use-deck-history';

/** Поля рамки, которые панель показывает числами. */
export type BoxField = 'x' | 'y' | 'cx' | 'cy';

/**
 * Общее значение у выделенных объектов, или null, если оно у них разное. Пустое выделение
 * тоже null: показывать нечего.
 */
export function commonValue<T>(
  items: readonly SlideElement[],
  read: (element: SlideElement) => T,
): T | null {
  const [first, ...rest] = items;
  if (!first) return null;
  const value = read(first);
  return rest.every((element) => Object.is(read(element), value)) ? value : null;
}

/** Рамка в пунктах: так её меряют в PowerPoint, и так же в пунктах кегль в той же панели. */
export function emuToPt(emu: number): number {
  return emu / EMU_PER_PT;
}

export function ptToEmu(pt: number): number {
  return Math.round(pt * EMU_PER_PT);
}

/**
 * Новое значение одного поля рамки для каждого выделенного объекта — как в Figma, где число
 * в панели при мультивыделении ставится каждому объекту. Размер меньше пункта не бывает:
 * объект нулевой ширины потом не ухватить. Неизменные рамки в список не попадают.
 */
export function setBoxField(
  items: readonly SlideElement[],
  field: BoxField,
  valuePt: number,
): ElementMove[] {
  const size = field === 'cx' || field === 'cy';
  const emu = size ? Math.max(EMU_PER_PT, ptToEmu(valuePt)) : ptToEmu(valuePt);
  return items.flatMap((element) => {
    if (element.box[field] === emu) return [];
    const box: Box = { ...element.box, [field]: emu };
    return [{ elementId: element.elementId, box }];
  });
}

/**
 * Один объект выравнивается по слайду, как в Figma по родительскому фрейму. Несколько —
 * между собой, это делает `alignBoxes`.
 */
export function alignToSlide(
  items: readonly SlideElement[],
  alignment: Alignment,
  slide: { readonly slideCx: number; readonly slideCy: number },
): ElementMove[] {
  return items.flatMap(({ elementId, box }) => {
    const next: Box = { ...box };
    if (alignment === 'left') next.x = 0;
    if (alignment === 'center') next.x = Math.round((slide.slideCx - box.cx) / 2);
    if (alignment === 'right') next.x = slide.slideCx - box.cx;
    if (alignment === 'top') next.y = 0;
    if (alignment === 'middle') next.y = Math.round((slide.slideCy - box.cy) / 2);
    if (alignment === 'bottom') next.y = slide.slideCy - box.cy;
    return next.x === box.x && next.y === box.y ? [] : [{ elementId, box: next }];
  });
}

/**
 * Пропорциональный размер: новая ширина тянет за собой высоту и наоборот. Нужен, когда
 * в панели включён замок пропорций.
 */
export function setBoxSizeLocked(
  items: readonly SlideElement[],
  field: 'cx' | 'cy',
  valuePt: number,
): ElementMove[] {
  const emu = Math.max(EMU_PER_PT, ptToEmu(valuePt));
  return items.flatMap((element) => {
    const { box } = element;
    if (box[field] === emu || box.cx <= 0 || box.cy <= 0) return [];
    const ratio = box.cx / box.cy;
    const next: Box =
      field === 'cx'
        ? { ...box, cx: emu, cy: Math.max(1, Math.round(emu / ratio)) }
        : { ...box, cy: emu, cx: Math.max(1, Math.round(emu * ratio)) };
    return [{ elementId: element.elementId, box: next }];
  });
}
