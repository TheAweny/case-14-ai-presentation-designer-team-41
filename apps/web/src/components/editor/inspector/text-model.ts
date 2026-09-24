import type {
  ColorRole,
  DesignSystem,
  ParagraphAlign,
  SlideElement,
  VerticalAlign,
} from '@lct/contracts';
import { typeRoleOf } from '@lct/slide-renderer';

export type TextElement = Extract<SlideElement, { kind: 'text' }>;

/**
 * Как текст выглядит на слайде: с учётом того, что run наследует от роли шаблона. Null в поле —
 * «у выделенного разное» (или у пустого текста нечего показать).
 */
export interface TextLook {
  readonly sizePt: number | null;
  readonly color: ColorRole | null;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly align: ParagraphAlign | null;
  readonly verticalAlign: VerticalAlign | null;
}

type Style = DesignSystem['typeScale'][number];

function styleOf(element: TextElement, designSystem: DesignSystem): Style | undefined {
  const role = typeRoleOf(element.role);
  return designSystem.typeScale.find((style) => style.role === role);
}

/** Роль палитры по hex из run. Пустой цвет наследуется от роли шаблона. */
function colorRoleOf(hex: string, fallback: ColorRole | null, designSystem: DesignSystem) {
  if (hex === '') return fallback;
  const lower = hex.toLowerCase();
  return designSystem.palette.find((entry) => entry.hex.toLowerCase() === lower)?.role ?? null;
}

function same<T>(values: readonly T[]): T | null {
  const [first, ...rest] = values;
  if (first === undefined) return null;
  return rest.every((value) => value === first) ? first : null;
}

/**
 * Сводка по всем runs всех выделенных текстов. B/I/U «включены», только если включены у каждого
 * run — как в Figma: кнопка нажата, когда нажатие ничего не изменит.
 */
export function textLook(elements: readonly TextElement[], designSystem: DesignSystem): TextLook {
  const sizes: number[] = [];
  const colors: (ColorRole | null)[] = [];
  let bold = true;
  let italic = true;
  let underline = true;
  let any = false;

  for (const element of elements) {
    const style = styleOf(element, designSystem);
    for (const run of element.paragraphs.flatMap((paragraph) => paragraph.runs)) {
      if (run.text === '') continue;
      any = true;
      const size = run.sizePt ?? style?.sizePt;
      if (size !== undefined) sizes.push(size);
      colors.push(colorRoleOf(run.color, style?.colorRole ?? null, designSystem));
      bold &&= run.bold ?? style?.bold ?? false;
      italic &&= run.italic ?? style?.italic ?? false;
      underline &&= run.underline ?? false;
    }
  }

  const aligns = elements.flatMap((element) =>
    element.paragraphs.map((paragraph) => paragraph.align ?? 'left'),
  );
  const verticals = elements.map((element) => element.verticalAlign ?? 'top');

  return {
    sizePt: same(sizes),
    color: same(colors),
    bold: any && bold,
    italic: any && italic,
    underline: any && underline,
    align: same(aligns),
    verticalAlign: same(verticals),
  };
}

/** Ступени шкалы шаблона без повторов роли: кегль выбирают из них, а не вписывают свой. */
export function typeSteps(designSystem: DesignSystem): readonly Style[] {
  return designSystem.typeScale.filter(
    (entry, index, all) => all.findIndex((other) => other.role === entry.role) === index,
  );
}
