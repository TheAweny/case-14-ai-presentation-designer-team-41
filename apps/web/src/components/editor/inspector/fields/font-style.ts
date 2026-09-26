/** Начертания, которые умеет текст слайда: два флага, четыре сочетания. */
export const FONT_STYLES = ['regular', 'italic', 'bold', 'boldItalic'] as const;

export type FontStyle = (typeof FONT_STYLES)[number];

/** Начертание по флагам; `null`, если хоть один флаг у выделенного разный. */
export function fontStyleOf(bold: boolean | null, italic: boolean | null): FontStyle | null {
  if (bold === null || italic === null) return null;
  if (bold) return italic ? 'boldItalic' : 'bold';
  return italic ? 'italic' : 'regular';
}

export function fontStyleFlags(style: FontStyle): { bold: boolean; italic: boolean } {
  return {
    bold: style === 'bold' || style === 'boldItalic',
    italic: style === 'italic' || style === 'boldItalic',
  };
}
