import { evaluateExpression } from './fields/expression';

/**
 * Число из поля панели. Запятая и точка равноправны, пробелы между разрядами допустимы.
 * Пустая строка и мусор дают null: поле тогда просто возвращается к прежнему значению.
 */
export function parseNumber(text: string): number | null {
  const normalized = text.trim().replace(/\s+/g, '').replace(',', '.').replace(/^−/, '-');
  if (normalized === '' || normalized === '-' || normalized === '.') return null;
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Шаг стрелкой без «пыли» плавающей точки: 0.1 + 0.2 остаётся 0.3. */
export function stepNumber(value: number, delta: number): number {
  return Math.round((value + delta) * 1000) / 1000;
}

/** Округление до `precision` знаков после запятой; `-0` не возвращает. */
export function roundTo(value: number, precision: number): number {
  const factor = 10 ** Math.max(0, Math.floor(precision));
  return Math.round(value * factor) / factor + 0;
}

/** Число для поля: не больше `precision` знаков, без хвостовых нулей. */
export function formatNumber(value: number, precision = 1): string {
  return String(roundTo(value, precision));
}

export function clampNumber(value: number, min?: number, max?: number): number {
  let next = value;
  if (min !== undefined) next = Math.max(min, next);
  if (max !== undefined) next = Math.min(max, next);
  return next;
}

/**
 * Что человек написал в поле.
 *
 * - `absolute` — новое значение: `120`, `100+20`, `(10+5)/3`, `-4`.
 * - `relative` — правка от текущего: `+10`, `- 10` (минус с пробелом, иначе это отрицательное
 *   число), `*2`, `/2`. У «разных» значений она применяется к каждому объекту от его значения.
 * - `empty` — поле очистили.
 *
 * `null` — мусор или деление на ноль: поле вернётся к прежнему значению.
 */
export type FieldInput =
  | { readonly kind: 'absolute'; readonly value: number }
  | { readonly kind: 'relative'; readonly apply: (current: number) => number }
  | { readonly kind: 'empty' };

export function parseFieldInput(text: string): FieldInput | null {
  const source = text.trim();
  if (source === '') return { kind: 'empty' };
  const head = source[0];
  const rest = source.slice(1);

  if (head === '*' || head === '×' || head === '/' || head === '÷') {
    const operand = evaluateExpression(rest);
    if (operand === null) return null;
    if (head === '*' || head === '×') return relative((current) => current * operand);
    if (operand === 0) return null;
    return relative((current) => current / operand);
  }
  if (head === '+') {
    const operand = evaluateExpression(rest);
    return operand === null ? null : relative((current) => current + operand);
  }
  if ((head === '-' || head === '−') && /^\s/.test(rest)) {
    const operand = evaluateExpression(rest);
    return operand === null ? null : relative((current) => current - operand);
  }

  const value = evaluateExpression(source);
  return value === null ? null : { kind: 'absolute', value };
}

function relative(apply: (current: number) => number): FieldInput {
  return { kind: 'relative', apply: (current) => apply(current) + 0 };
}
