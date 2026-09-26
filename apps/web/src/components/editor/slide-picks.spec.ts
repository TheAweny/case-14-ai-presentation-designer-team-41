import { describe, expect, it } from 'vitest';
import { blockDropIndex, pickSlide } from './slide-picks';

const order = ['a', 'b', 'c', 'd', 'e'];
const plain = { range: false, toggle: false };
const range = { range: true, toggle: false };
const toggle = { range: false, toggle: true };

describe('выбор слайдов', () => {
  it('щелчок выбирает один слайд и ставит якорь', () => {
    expect(pickSlide(order, { picked: ['a', 'b'], anchor: 'a' }, 'c', plain)).toEqual({
      picked: ['c'],
      open: 'c',
      anchor: 'c',
    });
  });

  it('Shift выбирает диапазон от якоря в любую сторону, якорь остаётся', () => {
    expect(pickSlide(order, { picked: ['b'], anchor: 'b' }, 'd', range)).toEqual({
      picked: ['b', 'c', 'd'],
      open: 'd',
      anchor: 'b',
    });
    expect(pickSlide(order, { picked: ['b', 'c', 'd'], anchor: 'b' }, 'a', range).picked).toEqual([
      'a',
      'b',
    ]);
  });

  it('Ctrl добавляет слайд в порядке колоды и снимает выбранный', () => {
    const added = pickSlide(order, { picked: ['d'], anchor: 'd' }, 'b', toggle);
    expect(added).toEqual({ picked: ['b', 'd'], open: 'b', anchor: 'b' });
    const removed = pickSlide(order, { picked: ['b', 'd'], anchor: 'b' }, 'b', toggle);
    expect(removed).toEqual({ picked: ['d'], open: 'd', anchor: 'd' });
  });

  it('последний выбранный слайд не снимается', () => {
    expect(pickSlide(order, { picked: ['c'], anchor: 'c' }, 'c', toggle).picked).toEqual(['c']);
  });
});

describe('перенос блока', () => {
  it('вниз встаёт после слайда под курсором, вверх — перед ним', () => {
    expect(blockDropIndex(order, ['b', 'c'], 'b', 'd')).toBe(2);
    expect(blockDropIndex(order, ['d', 'e'], 'e', 'b')).toBe(1);
    expect(blockDropIndex(order, ['a'], 'a', 'e')).toBe(4);
  });

  it('на одном из переносимых порядок не меняется', () => {
    expect(blockDropIndex(order, ['b', 'c'], 'b', 'c')).toBeNull();
  });
});
