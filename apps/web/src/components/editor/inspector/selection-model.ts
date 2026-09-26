import type { Box, ColorValue, DesignSystem, ElementStroke, SlideElement } from '@lct/contracts';
import type { ElementProps } from '@lct/deck-ops';
import { EMU_PER_PT } from '@lct/slide-renderer';
import type { Alignment } from '@/components/editor/slide-geometry';
import type { ElementMove, PropsEntry } from '@/components/editor/use-deck-history';

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

/**
 * Правка поля рамки «каждому от своего»: `+10` к X при мультивыделении сдвигает каждый
 * объект на 10 пт от его собственного X, как в Figma.
 */
export function setBoxFieldEach(
  items: readonly SlideElement[],
  field: BoxField,
  apply: (oldPt: number) => number,
): ElementMove[] {
  return items.flatMap((element) =>
    setBoxField([element], field, apply(emuToPt(element.box[field]))),
  );
}

type Decor = Extract<SlideElement, { kind: 'decor' }>;

/** Скругление, которое контракт подразумевает у round-rect без явного значения. */
export const DEFAULT_CORNER_RADIUS = 1 / 6;

/**
 * Радиус скругления в пунктах, как его показывает Figma. В слайде он хранится долей короткой
 * стороны; у прямоугольника он ноль. У остальных фигур скругления нет — null.
 */
export function cornerRadiusPt(element: Decor): number | null {
  const side = emuToPt(Math.min(element.box.cx, element.box.cy));
  if (element.shape === 'rect') return 0;
  if (element.shape !== 'round-rect') return null;
  return (element.cornerRadius ?? DEFAULT_CORNER_RADIUS) * side;
}

/** Наибольший радиус фигуры: половина короткой стороны, в пунктах. */
export function maxCornerRadiusPt(element: Decor): number {
  return emuToPt(Math.min(element.box.cx, element.box.cy)) / 2;
}

/**
 * Свойства, которые дают фигуре радиус `radiusPt`. Ноль делает её прямоугольником, любой
 * другой радиус — скруглённым прямоугольником, как в Figma, где радиус есть у любого
 * прямоугольника. Радиус больше половины короткой стороны упирается в неё.
 */
export function cornerRadiusProps(element: Decor, radiusPt: number): ElementProps {
  if (radiusPt <= 0) return { shape: 'rect' };
  const side = Math.min(element.box.cx, element.box.cy);
  if (side <= 0) return { shape: 'round-rect' };
  const share = Math.min(0.5, ptToEmu(radiusPt) / side);
  return { shape: 'round-rect', cornerRadius: Math.round(share * 1e6) / 1e6 };
}

/** Обводка, которую получает фигура без неё: тонкая сплошная линия. */
export function freshStroke(color: ColorValue): ElementStroke {
  return { color, widthEmu: EMU_PER_PT, dash: 'solid', head: 'none', tail: 'none' };
}

/**
 * Цвет новой обводки или линии, когда человек ещё не выбрал свой: роль текста шаблона, а без
 * неё — первая роль палитры.
 */
export function defaultStrokeColor(designSystem: DesignSystem): ColorValue {
  return designSystem.palette.some((entry) => entry.role === 'text')
    ? 'text'
    : (designSystem.palette[0]?.role ?? 'text');
}

/**
 * Цвет обводки фигурам — одной записью журнала. Фигура без обводки получает её целиком, у
 * остальных меняется только цвет. `null` убирает обводку у всех.
 */
export function strokeColorEntries(
  decors: readonly Decor[],
  color: ColorValue | null,
): PropsEntry[] {
  if (decors.length === 0) return [];
  if (color === null) {
    return [{ elementIds: decors.map((element) => element.elementId), props: { stroke: null } }];
  }
  const bare = decors.filter((element) => !element.stroke).map((element) => element.elementId);
  const stroked = decors.filter((element) => element.stroke).map((element) => element.elementId);
  const entries: PropsEntry[] = [];
  if (bare.length > 0) entries.push({ elementIds: bare, props: { stroke: freshStroke(color) } });
  if (stroked.length > 0) entries.push({ elementIds: stroked, props: { stroke: { color } } });
  return entries;
}

/**
 * Стрелка на конце линий: `head` — в начале, `tail` — в конце. Обводка сливается с той, что у
 * линии уже есть; линии без неё получают её целиком цветом `color`.
 */
export function lineEndEntries(
  decors: readonly Decor[],
  end: 'head' | 'tail',
  on: boolean,
  color: ColorValue,
): PropsEntry[] {
  const mark = on ? 'arrow' : 'none';
  const stroked = decors.filter((element) => element.stroke).map((element) => element.elementId);
  const bare = decors.filter((element) => !element.stroke).map((element) => element.elementId);
  const entries: PropsEntry[] = [];
  if (stroked.length > 0) entries.push({ elementIds: stroked, props: { stroke: { [end]: mark } } });
  if (bare.length > 0) {
    entries.push({ elementIds: bare, props: { stroke: { ...freshStroke(color), [end]: mark } } });
  }
  return entries;
}

/** Отражение фигур по оси: каждая — от своего состояния, всё одной записью журнала. */
export function flipEntries(decors: readonly Decor[], axis: 'flipH' | 'flipV'): PropsEntry[] {
  return decors.map((element) => ({
    elementIds: [element.elementId],
    props: axis === 'flipH' ? { flipH: element.flipH !== true } : { flipV: element.flipV !== true },
  }));
}
