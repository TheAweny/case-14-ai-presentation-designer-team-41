import { describe, expect, it } from 'vitest';
import type { PaletteEntry } from '@lct/contracts';
import { colorHex, isColorRole, isHexValue, normalizeHex, parseCssColor } from './color';

const meta = { source: 'measured', confidence: 1, parts: [] } as unknown as PaletteEntry['meta'];
const palette: PaletteEntry[] = [
  { role: 'accent', hex: 'ff6600', meta },
  { role: 'text', hex: '1A1A1A', meta },
];

describe('normalizeHex', () => {
  it.each([
    ['#abc', 'AABBCC'],
    ['abc', 'AABBCC'],
    ['#aabbcc', 'AABBCC'],
    ['aabbcc', 'AABBCC'],
    ['  #A1b2C3 ', 'A1B2C3'],
    ['000', '000000'],
  ])('%j → %s', (input, expected) => {
    expect(normalizeHex(input)).toBe(expected);
  });

  it.each([[''], ['#'], ['ab'], ['abcd'], ['abcde'], ['abcdefa'], ['#ggg'], ['##abc'], ['red']])(
    'мусор %j даёт null',
    (input) => {
      expect(normalizeHex(input)).toBeNull();
    },
  );
});

describe('роль или HEX', () => {
  it('различает значения по виду строки', () => {
    expect(isHexValue('A1B2C3')).toBe(true);
    expect(isHexValue('accent')).toBe(false);
    expect(isColorRole('accent')).toBe(true);
    expect(isColorRole('A1B2C3')).toBe(false);
  });

  it('роль берёт цвет из палитры, HEX — как есть', () => {
    expect(colorHex(palette, 'accent')).toBe('FF6600');
    expect(colorHex(palette, 'abcdef')).toBe('ABCDEF');
    expect(colorHex(palette, 'surface')).toBeNull();
  });
});

describe('parseCssColor', () => {
  it('понимает ответ пипетки в обоих видах', () => {
    expect(parseCssColor('#ff0080')).toBe('FF0080');
    expect(parseCssColor('rgb(255, 0, 128)')).toBe('FF0080');
    expect(parseCssColor('rgba(0 0 0 / 50%)')).toBe('000000');
    expect(parseCssColor('rgb(300, 0, 0)')).toBeNull();
    expect(parseCssColor('hsl(0 0% 0%)')).toBeNull();
  });
});
