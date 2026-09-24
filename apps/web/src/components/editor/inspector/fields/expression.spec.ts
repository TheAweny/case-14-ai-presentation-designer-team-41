import { describe, expect, it } from 'vitest';
import { evaluateExpression, normalizeExpression } from './expression';

describe('evaluateExpression', () => {
  it.each([
    ['42', 42],
    ['12.5', 12.5],
    ['12,5', 12.5],
    ['.5', 0.5],
    ['5.', 5],
    ['-4', -4],
    ['+4', 4],
    ['--4', 4],
    ['100+20', 120],
    ['100 + 20', 120],
    ['100-20', 80],
    ['50*2', 100],
    ['50×2', 100],
    ['50/4', 12.5],
    ['50÷4', 12.5],
    ['(10+5)/3', 5],
    ['2+3*4', 14],
    ['(2+3)*4', 20],
    ['10-2-3', 5],
    ['100/10/2', 5],
    ['-(3+2)', -5],
    ['2*-3', -6],
    ['((((1))))', 1],
    ['1 024', 1024],
    ['−7', -7],
  ])('%s = %s', (input, expected) => {
    expect(evaluateExpression(input)).toBeCloseTo(expected, 10);
  });

  it('пропускает единицы после чисел', () => {
    expect(evaluateExpression('12pt')).toBe(12);
    expect(evaluateExpression('12 pt')).toBe(12);
    expect(evaluateExpression('45°')).toBe(45);
    expect(evaluateExpression('50%')).toBe(50);
    expect(evaluateExpression('10px+2px')).toBe(12);
    expect(evaluateExpression('14 пт')).toBe(14);
  });

  it('не даёт минус ноль', () => {
    expect(Object.is(evaluateExpression('-0'), 0)).toBe(true);
    expect(Object.is(evaluateExpression('0*-1'), 0)).toBe(true);
  });

  it.each([
    [''],
    ['   '],
    ['abc'],
    ['pt'],
    ['1.2.3'],
    ['1+'],
    ['*2'],
    ['(1+2'],
    ['1+2)'],
    ['()'],
    ['2(3)'],
    ['1 2 +'],
    ['1e3'],
    ['Infinity'],
    ['NaN'],
    ['alert(1)'],
    ['1;2'],
    ['2**3'],
    ['10 % 3'],
  ])('мусор %j даёт null', (input) => {
    expect(evaluateExpression(input)).toBeNull();
  });

  it('деление на ноль даёт null', () => {
    expect(evaluateExpression('1/0')).toBeNull();
    expect(evaluateExpression('1/(2-2)')).toBeNull();
    expect(evaluateExpression('0/0')).toBeNull();
  });

  it('отказывается от слишком глубоких скобок и длинного ввода', () => {
    expect(evaluateExpression('('.repeat(40) + '1' + ')'.repeat(40))).toBeNull();
    expect(evaluateExpression('-'.repeat(40) + '1')).toBeNull();
    expect(evaluateExpression('1+'.repeat(150) + '1')).toBeNull();
  });
});

describe('normalizeExpression', () => {
  it('приводит знаки к ASCII и склеивает разряды', () => {
    expect(normalizeExpression(' 1 024 × 2 ')).toBe('1024 * 2');
    expect(normalizeExpression('3,5 ÷ 7')).toBe('3.5 / 7');
    expect(normalizeExpression('−1')).toBe('-1');
  });
});
