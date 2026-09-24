import type { ColorRole, ColorValue, PaletteEntry } from '@lct/contracts';

const HEX = /^[0-9a-fA-F]{6}$/;

/** Whether a colour value is six hex digits a user chose rather than a palette role. */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

export function paint(palette: readonly PaletteEntry[], ...roles: readonly ColorRole[]): string {
  for (const role of roles) {
    const hex = palette.find((entry) => entry.role === role)?.hex;
    if (hex) return `#${hex}`;
  }
  const first = palette[0];
  return first ? `#${first.hex}` : 'transparent';
}

/**
 * A colour value as CSS `#rrggbb`: the hex a user chose as written, a role through the palette.
 * A role the palette lacks falls back to `fallback` in order, then to the first palette entry.
 */
export function resolveColor(
  palette: readonly PaletteEntry[],
  value: ColorValue,
  ...fallback: readonly ColorRole[]
): string {
  if (isHexColor(value)) return `#${value}`;
  return paint(palette, value as ColorRole, ...fallback);
}

/** Roles a series reaches for first: the colours a template means to draw attention with. */
const SERIES_FIRST: readonly ColorRole[] = ['accent', 'accent-alt', 'positive', 'negative'];

/** Type colours still read on the page, but a chart in them looks like body text. */
const SERIES_LAST: readonly ColorRole[] = ['text', 'text-muted'];

/**
 * Roles that paint the page, a card, a hairline, or type that only reads on an accent.
 * A series in one of those colours disappears.
 */
const NOT_A_SERIES: ReadonlySet<ColorRole> = new Set([
  'background',
  'surface',
  'text-on-accent',
  'line',
]);

/**
 * Palette roles in the order series take them. The order is ours, not the palette's: a parser is
 * free to list the palette any way it likes, and the first series still has to be the accent.
 */
export function seriesRoles(palette: readonly PaletteEntry[]): readonly ColorRole[] {
  const present = new Set(palette.map((entry) => entry.role));
  const placed = new Set<ColorRole>([...SERIES_FIRST, ...SERIES_LAST]);
  const middle = palette
    .map((entry) => entry.role)
    .filter((role) => !placed.has(role) && !NOT_A_SERIES.has(role));
  return [...SERIES_FIRST, ...middle, ...SERIES_LAST].filter((role) => present.has(role));
}

/** Series `index` takes the next role of `seriesRoles`, and wraps around when they run out. */
export function seriesPaint(palette: readonly PaletteEntry[], index: number): string {
  const roles = seriesRoles(palette);
  if (roles.length === 0) {
    const entry = palette[index % Math.max(palette.length, 1)];
    return entry ? `#${entry.hex}` : 'transparent';
  }
  const role = roles[index % roles.length] ?? roles[0];
  return role ? paint(palette, role) : 'transparent';
}

/*
 * The profile names a typeface but not its class, so the class is read off the name. A wrong
 * guess costs only the fallback, which a browser uses when the face itself is missing.
 */
const MONOSPACE = /\b(mono|code|courier|consolas|menlo)\b/i;
const SANS = /\bsans\b/i;
const SERIF =
  /\b(serif|times|georgia|garamond|cambria|caladea|baskerville|bodoni|didot|palatino|minion|merriweather|lora|playfair|charter|century|antiqua|book)\b/i;

/** The generic family a browser falls back to when this face is not installed. */
export function genericFamily(font: string): 'serif' | 'sans-serif' | 'monospace' {
  if (MONOSPACE.test(font)) return 'monospace';
  if (!SANS.test(font) && SERIF.test(font)) return 'serif';
  return 'sans-serif';
}

/**
 * The typeface named by the template, quoted so a multi-word family stays one family, followed by
 * the generic family it belongs to. Without the generic a missing face falls back to the browser
 * default, which is a serif, and a sans-serif template turns into Times.
 */
export function fontFamily(font: string): string | undefined {
  const name = font.trim().replaceAll('"', '');
  if (!name) return undefined;
  return `"${name}", ${genericFamily(name)}`;
}
