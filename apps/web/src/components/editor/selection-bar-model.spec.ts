import { describe, expect, it } from 'vitest';
import type { SlideElement } from '@lct/contracts';
import { FONT_SIZE_PT } from '@lct/deck-ops';
import { barArea, barContext, leavesField, rovingIndex, stepFontSize } from './selection-bar-model';

const box = { x: 0, y: 0, cx: 100, cy: 100 };

describe('selection bar area', () => {
  const size = { width: 800, height: 600 };
  const padding = { top: 56, right: 24, bottom: 56, left: 76 };

  it('keeps clear of the edge the tool rail is docked to', () => {
    expect(barArea(size, padding, 'left')).toEqual({ x: 76, y: 0, width: 724, height: 600 });
    expect(barArea(size, padding, 'right')).toEqual({ x: 0, y: 0, width: 776, height: 600 });
    expect(barArea(size, padding, 'top')).toEqual({ x: 0, y: 56, width: 800, height: 544 });
    expect(barArea(size, padding, 'bottom')).toEqual({ x: 0, y: 0, width: 800, height: 544 });
  });

  it('uses the whole layer without a rail', () => {
    expect(barArea(size, padding, null)).toEqual({ x: 0, y: 0, width: 800, height: 600 });
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

describe('font size steps', () => {
  it('goes a whole point up or down', () => {
    expect(stepFontSize(12, 1)).toBe(13);
    expect(stepFontSize(12, -1)).toBe(11);
  });

  it('lands a fractional size on the next whole point', () => {
    expect(stepFontSize(10.5, 1)).toBe(11);
    expect(stepFontSize(10.5, -1)).toBe(10);
  });

  it('stays within what the journal accepts', () => {
    expect(stepFontSize(FONT_SIZE_PT.min, -1)).toBe(FONT_SIZE_PT.min);
    expect(stepFontSize(FONT_SIZE_PT.max, 1)).toBe(FONT_SIZE_PT.max);
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
