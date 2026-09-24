import type {
  ColorRole,
  ColorValue,
  DesignSystem,
  ParagraphAlign,
  SlideElement,
  VerticalAlign,
} from '@lct/contracts';
import { typeRoleOf } from '@lct/slide-renderer';
import type { RangeMarks } from '@/components/editor/active-text-editor';

export type TextElement = Extract<SlideElement, { kind: 'text' }>;

/**
 * Как текст выглядит на слайде: с учётом того, что run наследует от роли шаблона. Null в поле —
 * «у выделенного разное» (или у пустого текста нечего показать). Исключение — межстрочный
 * интервал: у него null — законное «Авто» (как у роли), а «разные» — undefined.
 */
export interface TextLook {
  readonly sizePt: number | null;
  /** Роль палитры, если цвет с ней совпадает, иначе свой HEX. */
  readonly color: ColorValue | null;
  /** Семейство, которым текст нарисован: своё у run или шрифт роли. */
  readonly font: string | null;
  readonly bold: boolean | null;
  readonly italic: boolean | null;
  /** Нажата, только если подчёркнуто всё: как кнопки в Figma. */
  readonly underline: boolean;
  /** Пункты; ненаследованный интервал показывается нулём. */
  readonly letterSpacingPt: number | null;
  /** Кратность одинарного; null — «Авто» (как у роли), undefined — разные. */
  readonly lineSpacing: number | null | undefined;
  /** Что даёт «Авто»: интервал роли, если он у всех выделенных один. */
  readonly autoLineSpacing: number | null;
  readonly align: ParagraphAlign | null;
  readonly verticalAlign: VerticalAlign | null;
}

type Style = DesignSystem['typeScale'][number];

export function styleOf(element: TextElement, designSystem: DesignSystem): Style | undefined {
  const role = typeRoleOf(element.role);
  return designSystem.typeScale.find((style) => style.role === role);
}

/**
 * Цвет run как значение поля: роль палитры, если hex с ней совпадает, иначе сам hex.
 * Пустой цвет наследуется от роли шаблона.
 */
export function colorValueOf(
  hex: string,
  fallback: ColorRole | null,
  designSystem: DesignSystem,
): ColorValue | null {
  const digits = hex.replace(/^#/, '');
  if (digits === '') return fallback;
  const upper = digits.toUpperCase();
  return designSystem.palette.find((entry) => entry.hex.toUpperCase() === upper)?.role ?? upper;
}

function same<T>(values: readonly T[]): T | null {
  const [first, ...rest] = values;
  if (first === undefined) return null;
  return rest.every((value) => value === first) ? first : null;
}

/** Как `same`, но «разные» отличимы от общего null: у интервала null — это «Авто». */
function agreed<T>(values: readonly T[]): T | undefined {
  const [first, ...rest] = values;
  if (first === undefined) return undefined;
  return rest.every((value) => value === first) ? first : undefined;
}

/**
 * Сводка по всем runs всех выделенных текстов. Начертание «разное», если у runs оно разное;
 * подчёркивание «включено», только если включено у каждого run.
 */
export function textLook(elements: readonly TextElement[], designSystem: DesignSystem): TextLook {
  const sizes: number[] = [];
  const colors: (ColorValue | null)[] = [];
  const fonts: string[] = [];
  const bolds: boolean[] = [];
  const italics: boolean[] = [];
  const spacings: number[] = [];
  let underline = true;
  let any = false;

  for (const element of elements) {
    const style = styleOf(element, designSystem);
    for (const run of element.paragraphs.flatMap((paragraph) => paragraph.runs)) {
      if (run.text === '') continue;
      any = true;
      const size = run.sizePt ?? style?.sizePt;
      if (size !== undefined) sizes.push(size);
      colors.push(colorValueOf(run.color, style?.colorRole ?? null, designSystem));
      const font = run.font || style?.font;
      if (font) fonts.push(font);
      bolds.push(run.bold ?? style?.bold ?? false);
      italics.push(run.italic ?? style?.italic ?? false);
      spacings.push(run.letterSpacingPt ?? 0);
      underline &&= run.underline ?? false;
    }
  }

  const paragraphs = elements.flatMap((element) => element.paragraphs);
  const aligns = paragraphs.map((paragraph) => paragraph.align ?? 'left');
  const verticals = elements.map((element) => element.verticalAlign ?? 'top');
  const autos = elements.map((element) => styleOf(element, designSystem)?.lineSpacing ?? null);

  return {
    sizePt: same(sizes),
    color: same(colors),
    font: same(fonts),
    bold: same(bolds),
    italic: same(italics),
    underline: any && underline,
    letterSpacingPt: same(spacings),
    lineSpacing: agreed(paragraphs.map((paragraph) => paragraph.lineSpacing ?? null)),
    autoLineSpacing: same(autos),
    align: same(aligns),
    verticalAlign: same(verticals),
  };
}

/**
 * Вид выделенного фрагмента в открытом наборе: метки набора поверх стиля роли. Разное по
 * выделению (`marks.mixed`) показывается как «разные».
 */
export function rangeLook(
  marks: RangeMarks,
  element: TextElement,
  designSystem: DesignSystem,
): TextLook {
  const style = styleOf(element, designSystem);
  const mixed = (field: RangeMarks['mixed'][number]) => marks.mixed.includes(field);
  return {
    sizePt: mixed('sizePt') ? null : (marks.sizePt ?? style?.sizePt ?? null),
    color: mixed('color')
      ? null
      : colorValueOf(marks.color ?? '', style?.colorRole ?? null, designSystem),
    font: mixed('font') ? null : (marks.font ?? style?.font ?? null),
    bold: marks.bold || (marks.boldMode !== 'false' && (style?.bold ?? false)),
    italic: marks.italic || (marks.italicMode !== 'false' && (style?.italic ?? false)),
    underline: marks.underlineMode === 'true',
    letterSpacingPt: mixed('letterSpacingPt') ? null : (marks.letterSpacingPt ?? 0),
    lineSpacing: mixed('lineSpacing') ? undefined : marks.lineSpacing,
    autoLineSpacing: style?.lineSpacing ?? null,
    align: marks.align ?? 'left',
    verticalAlign: element.verticalAlign ?? 'top',
  };
}

/**
 * Кегль, от которого считается правка «каждому от своего» (`+2` при разных кеглях): общий
 * кегль объекта или, если он внутри объекта разный, кегль первого непустого run.
 */
export function leadSizePt(element: TextElement, designSystem: DesignSystem): number | null {
  const own = textLook([element], designSystem).sizePt;
  if (own !== null) return own;
  const style = styleOf(element, designSystem);
  const first = element.paragraphs
    .flatMap((paragraph) => paragraph.runs)
    .find((run) => run.text !== '');
  return first?.sizePt ?? style?.sizePt ?? null;
}

/** Ступени шкалы шаблона без повторов роли: частые кегли в списке поля, ввести можно любой. */
export function typeSteps(designSystem: DesignSystem): readonly Style[] {
  return designSystem.typeScale.filter(
    (entry, index, all) => all.findIndex((other) => other.role === entry.role) === index,
  );
}

/** Шрифты шаблона без повторов: семейства темы, потом шрифты ролей шкалы. */
export function templateFonts(designSystem: DesignSystem): readonly string[] {
  const all = [
    ...designSystem.typeFamilies.map((family) => family.font),
    ...designSystem.typeScale.map((style) => style.font),
  ];
  return all.filter((font, index) => font !== '' && all.indexOf(font) === index);
}
