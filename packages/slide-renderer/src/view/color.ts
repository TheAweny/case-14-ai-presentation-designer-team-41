import type { ColorRole, PaletteEntry } from '@lct/contracts';

/**
 * Roles that paint the page, a card, a hairline, or type that only reads on an accent.
 * A series in one of those colours disappears, so series walk the palette in order
 * with these roles set aside.
 */
const NOT_A_SERIES = new Set<ColorRole>(['background', 'surface', 'text-on-accent', 'line']);

export function paint(palette: readonly PaletteEntry[], ...roles: readonly ColorRole[]): string {
  for (const role of roles) {
    const hex = palette.find((entry) => entry.role === role)?.hex;
    if (hex) return `#${hex}`;
  }
  const first = palette[0];
  return first ? `#${first.hex}` : 'transparent';
}

/** Series `index` takes the next palette colour that can sit on the page. */
export function seriesPaint(palette: readonly PaletteEntry[], index: number): string {
  const marks = palette.filter((entry) => !NOT_A_SERIES.has(entry.role));
  const source = marks.length > 0 ? marks : palette;
  const entry = source[index % source.length] ?? source[0];
  return entry ? `#${entry.hex}` : 'transparent';
}

/** The typeface named by the template, quoted so a multi-word family stays one family. */
export function fontFamily(font: string): string | undefined {
  const name = font.trim();
  if (!name) return undefined;
  return `"${name.replaceAll('"', '')}"`;
}
