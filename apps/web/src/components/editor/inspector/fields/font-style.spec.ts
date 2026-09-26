import { describe, expect, it } from 'vitest';
import { FONT_STYLES, fontStyleFlags, fontStyleOf } from './font-style';

describe('начертание', () => {
  it('собирается из флагов и раскладывается обратно', () => {
    for (const style of FONT_STYLES) {
      const { bold, italic } = fontStyleFlags(style);
      expect(fontStyleOf(bold, italic)).toBe(style);
    }
  });

  it('разное, если хоть один флаг разный', () => {
    expect(fontStyleOf(null, false)).toBeNull();
    expect(fontStyleOf(true, null)).toBeNull();
  });
});
