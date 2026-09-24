import {
  colorRoleSchema,
  hexColorSchema,
  type ColorRole,
  type ColorValue,
  type PaletteEntry,
} from '@lct/contracts';

/**
 * HEX из поля: `#abc`, `abc`, `#aabbcc`, `aabbcc`, с пробелами по краям. Ответ — шесть цифр
 * в верхнем регистре без решётки, как цвет хранится в слайде. Мусор даёт `null`.
 */
export function normalizeHex(text: string): string | null {
  const digits = text.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(digits)) {
    return [...digits]
      .map((digit) => digit + digit)
      .join('')
      .toUpperCase();
  }
  return hexColorSchema.safeParse(digits).success ? digits.toUpperCase() : null;
}

export function isHexValue(value: ColorValue): boolean {
  return hexColorSchema.safeParse(value).success;
}

export function isColorRole(value: ColorValue): value is ColorRole {
  return colorRoleSchema.safeParse(value).success;
}

/**
 * Шесть цифр цвета для показа: свой HEX как есть, роль — из палитры шаблона. Роли, которой
 * в палитре нет, отвечает `null`: поле тогда рисует пустой квадратик, а не выдуманный цвет.
 */
export function colorHex(palette: readonly PaletteEntry[], value: ColorValue): string | null {
  if (isHexValue(value)) return value.toUpperCase();
  return palette.find((entry) => entry.role === value)?.hex.toUpperCase() ?? null;
}

/**
 * Цвет из пипетки. Chrome отдаёт `#rrggbb`, но спецификация разрешает и `rgb(r, g, b)` —
 * принимаем оба вида.
 */
export function parseCssColor(text: string): string | null {
  const hex = normalizeHex(text);
  if (hex) return hex;
  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i.exec(text.trim());
  if (!rgb) return null;
  const channels = rgb.slice(1, 4).map(Number);
  if (channels.some((channel) => channel > 255)) return null;
  return channels
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}
