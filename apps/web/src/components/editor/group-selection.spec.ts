import { describe, expect, it } from 'vitest';
import type { Box, SlideElement } from '@lct/contracts';
import {
  alignUnits,
  distributeUnits,
  unitCount,
  canGroup,
  canUngroup,
  enterGroup,
  exitGroup,
  isWholeGroup,
  resolvePick,
  selectionScope,
  stepUnits,
  unitOf,
} from './group-selection';

function shape(elementId: string, groupIds?: readonly string[], box?: Partial<Box>): SlideElement {
  return {
    kind: 'decor',
    elementId,
    role: 'decoration',
    box: { x: 0, y: 0, cx: 100, cy: 100, ...box },
    sourceShapeId: null,
    ...(groupIds ? { groupIds: [...groupIds] } : null),
  };
}

// Карточка: подложка и группа «номер + подпись» внутри, рядом отдельная линия.
const card = [
  shape('panel', ['card']),
  shape('number', ['card', 'label']),
  shape('caption', ['card', 'label']),
  shape('rule'),
];

describe('выделение с группами', () => {
  it('щелчок по объекту группы выбирает всю группу верхнего уровня', () => {
    expect(unitOf(card, 'number')).toEqual(['panel', 'number', 'caption']);
    expect(unitOf(card, 'rule')).toEqual(['rule']);
    expect(resolvePick(card, [], ['caption'], false)).toEqual(['panel', 'number', 'caption']);
  });

  it('рамка выделения берёт группу целиком, даже задев один её объект', () => {
    expect(resolvePick(card, [], ['caption', 'rule'], false)).toEqual([
      'panel',
      'number',
      'caption',
      'rule',
    ]);
  });

  it('двойной щелчок входит на уровень глубже, следующий — набор', () => {
    const group = unitOf(card, 'number');
    const label = enterGroup(card, group, 'number');
    expect(label).toEqual(['number', 'caption']);
    const number = enterGroup(card, label ?? [], 'number');
    expect(number).toEqual(['number']);
    expect(enterGroup(card, number ?? [], 'number')).toBeNull();
    expect(enterGroup(card, [], 'rule')).toBeNull();
  });

  it('внутри группы щелчок выбирает соседей, а щелчок мимо выходит наверх', () => {
    expect(selectionScope(card, ['number'])).toEqual(['card', 'label']);
    expect(resolvePick(card, ['number'], ['caption'], false)).toEqual(['caption']);
    expect(resolvePick(card, ['number', 'caption'], ['panel'], false)).toEqual(['panel']);
    expect(resolvePick(card, ['panel'], ['rule'], false)).toEqual(['rule']);
    expect(resolvePick(card, ['rule'], ['panel'], false)).toEqual(['panel', 'number', 'caption']);
  });

  it('Shift добавляет группу целиком и целиком её снимает', () => {
    const both = resolvePick(card, ['rule'], ['rule', 'panel'], true);
    expect(both).toEqual(['rule', 'panel', 'number', 'caption']);
    expect(resolvePick(card, both, ['rule', 'panel', 'caption'], true)).toEqual(['rule']);
  });

  it('Ctrl+щелчок выбирает объект сквозь группы', () => {
    expect(resolvePick(card, [], ['caption'], false, true)).toEqual(['caption']);
    expect(selectionScope(card, ['caption'])).toEqual(['card', 'label']);
  });

  it('Esc поднимается на уровень вверх', () => {
    expect(exitGroup(card, ['number'])).toEqual(['number', 'caption']);
    expect(exitGroup(card, ['number', 'caption'])).toEqual(['panel', 'number', 'caption']);
    expect(exitGroup(card, ['panel', 'number', 'caption'])).toBeNull();
    expect(exitGroup(card, [])).toBeNull();
  });

  it('Tab идёт по узлам своего уровня', () => {
    expect(stepUnits(card, [], 1)).toEqual(['panel', 'number', 'caption']);
    expect(stepUnits(card, ['panel', 'number', 'caption'], 1)).toEqual(['rule']);
    expect(stepUnits(card, ['number'], 1)).toEqual(['caption']);
    expect(stepUnits(card, ['panel'], -1)).toEqual(['number', 'caption']);
  });

  it('группировать можно два узла и больше, разгруппировать — выбранную группу', () => {
    expect(canGroup(card, ['rule'])).toBe(false);
    expect(canGroup(card, ['panel', 'number', 'caption'])).toBe(false);
    expect(canGroup(card, ['panel', 'number', 'caption', 'rule'])).toBe(true);
    expect(canUngroup(card, ['panel', 'number', 'caption'])).toBe(true);
    expect(canUngroup(card, ['rule'])).toBe(false);
    expect(canUngroup(card, ['number'])).toBe(false);
  });

  it('одна группа целиком — это одна рамка', () => {
    expect(isWholeGroup(card, ['panel', 'number', 'caption'])).toBe(true);
    expect(isWholeGroup(card, ['number', 'caption'])).toBe(true);
    expect(isWholeGroup(card, ['panel', 'number', 'caption', 'rule'])).toBe(false);
    expect(isWholeGroup(card, ['rule'])).toBe(false);
  });
});

describe('выравнивание групп', () => {
  const slide = { slideCx: 1000, slideCy: 500 };
  const elements = [
    shape('a', ['g'], { x: 100, y: 100 }),
    shape('b', ['g'], { x: 300, y: 200 }),
    shape('c', undefined, { x: 600, y: 50, cx: 50 }),
  ];

  it('двигает группу целиком, не выравнивая её объекты между собой', () => {
    const moves = alignUnits(elements, ['a', 'b', 'c'], 'top', slide);
    expect(moves).toEqual([
      { elementId: 'a', box: { x: 100, y: 50, cx: 100, cy: 100 } },
      { elementId: 'b', box: { x: 300, y: 150, cx: 100, cy: 100 } },
    ]);
  });

  it('распределяет группы как один объект', () => {
    const row = [
      shape('a', ['g'], { x: 0, cx: 100 }),
      shape('b', ['g'], { x: 100, cx: 100 }),
      shape('c', undefined, { x: 250, cx: 50 }),
      shape('d', undefined, { x: 500, cx: 100 }),
    ];
    // Группа — рамка 0…200, промежутки поровну: (600 − 200 − 50 − 100) / 2 = 125.
    expect(distributeUnits(row, ['a', 'b', 'c', 'd'], 'horizontal')).toEqual([
      { elementId: 'c', box: { x: 325, y: 0, cx: 50, cy: 100 } },
    ]);
    expect(unitCount(row, ['a', 'b', 'c', 'd'])).toBe(3);
  });

  it('одну группу выравнивает по слайду', () => {
    const moves = alignUnits(elements, ['a', 'b'], 'left', slide);
    expect(moves.map((move) => move.box.x)).toEqual([0, 200]);
  });
});
