import { describe, expect, it } from 'vitest';
import {
  SCRUB_THRESHOLD_PX,
  formatScrubDelta,
  scrubDelta,
  scrubFactor,
  scrubStarted,
  scrubValue,
} from './scrub';

const none = { shiftKey: false, altKey: false };
const shift = { shiftKey: true, altKey: false };
const alt = { shiftKey: false, altKey: true };

describe('scrubFactor', () => {
  it('Shift — десять шагов, Alt — десятая шага, вместе — обычный шаг', () => {
    expect(scrubFactor(none)).toBe(1);
    expect(scrubFactor(shift)).toBe(10);
    expect(scrubFactor(alt)).toBe(0.1);
    expect(scrubFactor({ shiftKey: true, altKey: true })).toBe(1);
  });
});

describe('scrubDelta', () => {
  it('пиксель движения — один шаг поля', () => {
    expect(scrubDelta(5, 1, none)).toBe(5);
    expect(scrubDelta(-3, 1, none)).toBe(-3);
    expect(scrubDelta(2, 0.5, none)).toBe(1);
    expect(scrubDelta(2, 1, shift)).toBe(20);
    expect(scrubDelta(2, 1, alt)).toBeCloseTo(0.2, 10);
  });
});

describe('scrubStarted', () => {
  it('до порога нажатие остаётся щелчком', () => {
    expect(scrubStarted(0)).toBe(false);
    expect(scrubStarted(SCRUB_THRESHOLD_PX - 1)).toBe(false);
    expect(scrubStarted(SCRUB_THRESHOLD_PX)).toBe(true);
    expect(scrubStarted(-SCRUB_THRESHOLD_PX)).toBe(true);
  });
});

describe('scrubValue', () => {
  it('округляет до точности поля', () => {
    expect(scrubValue(10, 0.1 + 0.2, { precision: 1 })).toBe(10.3);
    expect(scrubValue(10, 0.26, { precision: 0 })).toBe(10);
  });

  it('держит значение в границах', () => {
    expect(scrubValue(95, 20, { min: 0, max: 100, precision: 0 })).toBe(100);
    expect(scrubValue(5, -20, { min: 1, precision: 1 })).toBe(1);
  });

  it('копит мелкие шаги Alt без потерь', () => {
    let accumulated = 0;
    for (let move = 0; move < 10; move += 1) accumulated += scrubDelta(1, 1, alt);
    expect(scrubValue(0, accumulated, { precision: 1 })).toBe(1);
  });
});

describe('formatScrubDelta', () => {
  it('показывает прирост со знаком', () => {
    expect(formatScrubDelta(12, 1)).toBe('+12');
    expect(formatScrubDelta(-3.46, 1)).toBe('−3.5');
    expect(formatScrubDelta(0.01, 1)).toBe('0');
  });
});
