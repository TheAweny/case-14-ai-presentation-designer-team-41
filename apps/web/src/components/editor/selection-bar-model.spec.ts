import { describe, expect, it } from 'vitest';
import type { SlideElement } from '@lct/contracts';
import { barArea, barContext, leavesField, rovingIndex } from './selection-bar-model';

const box = { x: 0, y: 0, cx: 100, cy: 100 };

describe('selection bar area', () => {
  const size = { width: 800, height: 600 };
  const rail = { x: 12, y: 200, width: 52, height: 300 };

  it('keeps clear of the edge the tool rail is docked to', () => {
    expect(barArea(size, { side: 'left', box: rail })).toEqual({
      x: 64,
      y: 0,
      width: 736,
      height: 600,
    });
    const right = { ...rail, x: 736 };
    expect(barArea(size, { side: 'right', box: right })).toEqual({
      x: 0,
      y: 0,
      width: 736,
      height: 600,
    });
    const top = { x: 200, y: 12, width: 300, height: 52 };
    expect(barArea(size, { side: 'top', box: top })).toEqual({
      x: 0,
      y: 64,
      width: 800,
      height: 536,
    });
    const bottom = { ...top, y: 536 };
    expect(barArea(size, { side: 'bottom', box: bottom })).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 536,
    });
  });

  it('uses the whole layer without a rail or with one let go mid-canvas', () => {
    const whole = { x: 0, y: 0, width: 800, height: 600 };
    expect(barArea(size, null)).toEqual(whole);
    expect(barArea(size, { side: 'left', box: { ...rail, x: 400 } })).toEqual(whole);
    // Рейка за пределами слоя (узкое окно) места не отнимает.
    expect(barArea(size, { side: 'left', box: { ...rail, x: -80 } })).toEqual(whole);
  });
});

function element(kind: SlideElement['kind'], extra: object = {}): SlideElement {
  return {
    kind,
    elementId: kind,
    role: 'body',
    box,
    sourceShapeId: null,
    ...extra,
  } as SlideElement;
}

describe('selection bar context', () => {
  it('shows the controls of the one selected kind', () => {
    expect(barContext([element('text')])).toBe('text');
    expect(barContext([element('image')])).toBe('image');
    expect(barContext([element('table')])).toBe('table');
    expect(barContext([element('chart')])).toBe('chart');
  });

  it('tells a line from a shape', () => {
    expect(barContext([element('decor', { shape: 'line' })])).toBe('line');
    expect(barContext([element('decor', { shape: 'ellipse' })])).toBe('shape');
    // Оформление шаблона без названной формы — тоже фигура.
    expect(barContext([element('decor')])).toBe('shape');
  });

  it('aligns several objects whatever they are, and has nothing for none', () => {
    expect(barContext([element('text'), element('text')])).toBe('multi');
    expect(barContext([element('text'), element('image')])).toBe('multi');
    expect(barContext([])).toBeNull();
  });
});

describe('toolbar keys', () => {
  it('moves between controls with arrows, round the ends', () => {
    expect(rovingIndex(0, 4, 'ArrowRight')).toBe(1);
    expect(rovingIndex(3, 4, 'ArrowRight')).toBe(0);
    expect(rovingIndex(0, 4, 'ArrowLeft')).toBe(3);
  });

  it('jumps to the ends with Home and End and ignores other keys', () => {
    expect(rovingIndex(2, 4, 'Home')).toBe(0);
    expect(rovingIndex(1, 4, 'End')).toBe(3);
    expect(rovingIndex(1, 4, 'ArrowDown')).toBeNull();
    expect(rovingIndex(0, 0, 'ArrowRight')).toBeNull();
  });

  it('leaves a field only from the edge of its text', () => {
    expect(leavesField('ArrowLeft', { start: 0, end: 0, length: 2 })).toBe(true);
    expect(leavesField('ArrowRight', { start: 2, end: 2, length: 2 })).toBe(true);
    expect(leavesField('ArrowLeft', { start: 1, end: 1, length: 2 })).toBe(false);
    // Выделенный текст стрелка сначала снимает.
    expect(leavesField('ArrowRight', { start: 0, end: 2, length: 2 })).toBe(false);
    expect(leavesField('Home', { start: 0, end: 0, length: 2 })).toBe(false);
  });
});
