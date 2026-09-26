import type { Box } from '@lct/contracts';

/**
 * Как рамка текста ведёт себя, пока в ней печатают.
 *
 * - `grow` — рамка растёт вниз под текст, как «Auto height» в Figma и «Подгонять размер фигуры
 *   под текст» в Google Slides и PowerPoint. Ниже исходной высоты не сжимается: рамку, которую
 *   человек нарисовал выше текста, набор не схлопывает.
 * - `fixed` — рамка шаблона: её место задал макет, набор его не двигает. Не влезающий текст
 *   подсвечивается, а решает человек (или агент переписывает текст).
 */
export type TextFit = 'grow' | 'fixed';

/** Рамка шаблона — та, что пришла из фигуры макета; нарисованная в редакторе — своя. */
export function textFitOf(element: { readonly sourceShapeId: number | null }): TextFit {
  return element.sourceShapeId === null ? 'grow' : 'fixed';
}

/**
 * Пиксели экрана в EMU слайда. Ширина кадра и высота текста меряются в одних и тех же
 * экранных пикселях, поэтому зум холста в пропорции сокращается.
 */
export function pxToEmu(px: number, slideWidthPx: number, slideCx: number): number {
  if (!(slideWidthPx > 0) || !Number.isFinite(px)) return 0;
  return (px / slideWidthPx) * slideCx;
}

export interface FittedBox {
  /** Рамка, какой её показывать и записывать. У `fixed` — всегда исходная. */
  readonly box: Box;
  /** Текст длиннее рамки, а рамка расти не может. */
  readonly overflow: boolean;
}

/**
 * Рамка под текст высотой `contentCy` (EMU). `tolerance` — сколько EMU перелёта не считать
 * переполнением: округление строк на экране даёт доли пикселя.
 */
export function fitTextBox(base: Box, contentCy: number, fit: TextFit, tolerance = 0): FittedBox {
  const content = Number.isFinite(contentCy) ? Math.max(0, Math.ceil(contentCy)) : 0;
  const over = content > base.cy + Math.max(0, tolerance);
  if (fit === 'fixed') return { box: base, overflow: over };
  if (!over) return { box: base, overflow: false };
  return { box: { ...base, cy: content }, overflow: false };
}
