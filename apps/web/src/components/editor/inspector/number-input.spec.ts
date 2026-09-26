import { describe, expect, it } from 'vitest';
import {
  clampNumber,
  formatNumber,
  parseFieldInput,
  roundTo,
  type FieldInput,
} from './number-input';

function applied(input: FieldInput | null, current: number): number | null {
  if (!input) return null;
  if (input.kind === 'absolute') return input.value;
  if (input.kind === 'relative') return input.apply(current);
  return null;
}

describe('parseFieldInput', () => {
  it('число и выражение задают значение', () => {
    expect(parseFieldInput('120')).toEqual({ kind: 'absolute', value: 120 });
    expect(parseFieldInput('100+20')).toEqual({ kind: 'absolute', value: 120 });
    expect(parseFieldInput('(10+5)/3')).toEqual({ kind: 'absolute', value: 5 });
    expect(parseFieldInput('12pt')).toEqual({ kind: 'absolute', value: 12 });
  });

  it('минус вплотную к числу — отрицательное число, а не правка', () => {
    expect(parseFieldInput('-4')).toEqual({ kind: 'absolute', value: -4 });
    expect(parseFieldInput('-4+1')).toEqual({ kind: 'absolute', value: -3 });
  });

  it('знак в начале — правка от текущего значения', () => {
    expect(applied(parseFieldInput('+10'), 100)).toBe(110);
    expect(applied(parseFieldInput('+ 10'), 100)).toBe(110);
    expect(applied(parseFieldInput('+-10'), 100)).toBe(90);
    expect(applied(parseFieldInput('- 10'), 100)).toBe(90);
    expect(applied(parseFieldInput('− 10'), 100)).toBe(90);
    expect(applied(parseFieldInput('*2'), 100)).toBe(200);
    expect(applied(parseFieldInput('×2'), 100)).toBe(200);
    expect(applied(parseFieldInput('/2'), 100)).toBe(50);
    expect(applied(parseFieldInput('÷4'), 100)).toBe(25);
    expect(applied(parseFieldInput('*(1+1)'), 7)).toBe(14);
    expect(applied(parseFieldInput('+5pt'), 7)).toBe(12);
  });

  it('правка применяется к каждому значению отдельно', () => {
    const input = parseFieldInput('+10');
    expect(input?.kind).toBe('relative');
    if (input?.kind !== 'relative') return;
    expect([0, 5, -20].map(input.apply)).toEqual([10, 15, -10]);
  });

  it('пустое поле — отдельный случай', () => {
    expect(parseFieldInput('')).toEqual({ kind: 'empty' });
    expect(parseFieldInput('   ')).toEqual({ kind: 'empty' });
  });

  it('мусор и деление на ноль дают null', () => {
    expect(parseFieldInput('abc')).toBeNull();
    expect(parseFieldInput('+')).toBeNull();
    expect(parseFieldInput('*')).toBeNull();
    expect(parseFieldInput('/0')).toBeNull();
    expect(parseFieldInput('/(1-1)')).toBeNull();
    expect(parseFieldInput('1/0')).toBeNull();
    expect(parseFieldInput('+abc')).toBeNull();
    expect(parseFieldInput('*2*')).toBeNull();
  });

  it('умножение на ноль допустимо', () => {
    expect(applied(parseFieldInput('*0'), 5)).toBe(0);
  });
});

describe('roundTo и formatNumber', () => {
  it('округляют до точности поля без хвостовых нулей', () => {
    expect(roundTo(3.14159, 2)).toBe(3.14);
    expect(roundTo(2.5, 0)).toBe(3);
    expect(formatNumber(12, 1)).toBe('12');
    expect(formatNumber(12.34, 1)).toBe('12.3');
    expect(formatNumber(12.35, 2)).toBe('12.35');
    expect(formatNumber(12.5)).toBe('12.5');
    expect(formatNumber(-0.01, 1)).toBe('0');
  });
});

describe('clampNumber', () => {
  it('зажимает в границы, если они есть', () => {
    expect(clampNumber(5, 0, 3)).toBe(3);
    expect(clampNumber(-1, 0)).toBe(0);
    expect(clampNumber(7)).toBe(7);
  });
});
