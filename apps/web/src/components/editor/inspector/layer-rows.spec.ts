import { describe, expect, it } from 'vitest';
import type { SlideElement } from '@lct/contracts';
import { layerRows, pickRows, revealedGroups, textSnippet } from './layer-rows';

function shape(elementId: string, groupIds?: readonly string[], locked?: boolean): SlideElement {
  return {
    kind: 'decor',
    elementId,
    role: 'decoration',
    box: { x: 0, y: 0, cx: 100, cy: 100 },
    sourceShapeId: null,
    ...(groupIds ? { groupIds: [...groupIds] } : null),
    ...(locked ? { locked } : null),
  };
}

function text(elementId: string, words: string): SlideElement {
  return {
    kind: 'text',
    elementId,
    role: 'body',
    box: { x: 0, y: 0, cx: 100, cy: 100 },
    sourceShapeId: null,
    paragraphs: [
      {
        level: 0,
        lineSpacing: null,
        runs: [{ text: words, font: '', sizePt: 16, bold: null, italic: null, color: '' }],
      },
    ],
    overflow: null,
  };
}

const elements = [
  shape('background', undefined, true),
  shape('panel', ['card']),
  shape('number', ['card']),
  shape('rule'),
];

describe('строки панели слоёв', () => {
  it('идут сверху вниз, группа свёрнута, пока её не раскрыли', () => {
    const rows = layerRows(elements, new Set());
    expect(rows.map((row) => row.id)).toEqual(['rule', 'card', 'background']);
    expect(rows[1]?.elementIds).toEqual(['panel', 'number']);
    expect(rows[2]?.locked).toBe(true);
  });

  it('раскрытая группа показывает детей глубже и тоже сверху вниз', () => {
    const rows = layerRows(elements, new Set(['card']));
    expect(rows.map((row) => `${'  '.repeat(row.depth)}${row.id}`)).toEqual([
      'rule',
      'card',
      '  number',
      '  panel',
      'background',
    ]);
    expect(rows[2]?.parent).toEqual(['card']);
  });

  it('раскрывает группу, внутри которой что-то выделено', () => {
    expect([...revealedGroups(elements, ['number'])]).toEqual(['card']);
    expect([...revealedGroups(elements, ['panel', 'number'])]).toEqual([]);
  });
});

describe('выбор строк', () => {
  const rows = layerRows(elements, new Set(['card']));

  it('щелчок выбирает объект или всю группу', () => {
    expect(pickRows(rows, [], null, 'card', { range: false, toggle: false })).toEqual([
      'panel',
      'number',
    ]);
    expect(pickRows(rows, ['rule'], null, 'panel', { range: false, toggle: false })).toEqual([
      'panel',
    ]);
  });

  it('Ctrl добавляет и снимает, Shift берёт строки от якоря', () => {
    expect(pickRows(rows, ['rule'], 'rule', 'panel', { range: false, toggle: true })).toEqual([
      'rule',
      'panel',
    ]);
    expect(
      pickRows(rows, ['rule', 'panel'], 'rule', 'panel', { range: false, toggle: true }),
    ).toEqual(['rule']);
    expect(pickRows(rows, ['rule'], 'rule', 'number', { range: true, toggle: false })).toEqual([
      'rule',
      'panel',
      'number',
    ]);
  });
});

describe('имя текстового слоя', () => {
  it('берёт первые слова и режет по слову', () => {
    expect(textSnippet(text('t', '  Выручка   выросла '))).toBe('Выручка выросла');
    expect(textSnippet(text('t', 'Конверсия выросла на треть за второй квартал подряд'), 30)).toBe(
      'Конверсия выросла на треть за…',
    );
    expect(textSnippet(text('t', '   '))).toBeNull();
    expect(textSnippet(shape('s'))).toBeNull();
  });
});
