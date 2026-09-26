/** Colour arithmetic for the contrast check, on sRGB channels from 0 to 255. */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** `#rrggbb` or six bare hex digits. Anything else — a CSS keyword, a mix — is not judged. */
export function parseHex(value: string): Rgb | null {
  const digits = /^#?([0-9a-fA-F]{6})$/.exec(value.trim())?.[1];
  if (!digits) return null;
  const n = Number.parseInt(digits, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

export function toHex({ r, g, b }: Rgb): string {
  return [r, g, b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/** Relative luminance as WCAG 2 defines it. */
export function luminance({ r, g, b }: Rgb): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio, from 1 to 21, whichever colour is lighter. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `top` painted at `opacity` over `bottom`. */
export function over(top: Rgb, bottom: Rgb, opacity: number): Rgb {
  const a = Math.min(Math.max(opacity, 0), 1);
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
  };
}
