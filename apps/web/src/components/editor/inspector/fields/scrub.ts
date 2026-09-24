import { clampNumber, roundTo } from '../number-input';

/**
 * Перетаскивание значения за подпись поля, как в Figma: пиксель движения — один шаг,
 * с Shift — десять шагов, с Alt — десятая шага. Модификатор читается на каждом движении,
 * поэтому его можно зажать и отпустить посреди жеста без скачка значения.
 */

/** Сдвиг, после которого нажатие на подпись становится перетаскиванием, а не щелчком. */
export const SCRUB_THRESHOLD_PX = 3;

export interface ScrubModifiers {
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

export function scrubFactor({ shiftKey, altKey }: ScrubModifiers): number {
  if (shiftKey && !altKey) return 10;
  if (altKey && !shiftKey) return 0.1;
  return 1;
}

/** Прирост значения за одно движение мыши на `movementX` пикселей. */
export function scrubDelta(movementX: number, step: number, modifiers: ScrubModifiers): number {
  return movementX * step * scrubFactor(modifiers);
}

/** Щелчок или уже перетаскивание: решает только горизонтальный сдвиг от точки нажатия. */
export function scrubStarted(offsetX: number): boolean {
  return Math.abs(offsetX) >= SCRUB_THRESHOLD_PX;
}

export interface ScrubBounds {
  readonly min?: number;
  readonly max?: number;
  readonly precision: number;
}

/** Значение поля при накопленном приросте: округлено до точности поля и зажато в границы. */
export function scrubValue(start: number, accumulated: number, bounds: ScrubBounds): number {
  return clampNumber(roundTo(start + accumulated, bounds.precision), bounds.min, bounds.max);
}

/** Подпись прироста для «разных» значений: `+12`, `−3.5`, `0`. */
export function formatScrubDelta(accumulated: number, precision: number): string {
  const rounded = roundTo(accumulated, precision);
  if (rounded > 0) return `+${rounded}`;
  if (rounded < 0) return `−${Math.abs(rounded)}`;
  return '0';
}
