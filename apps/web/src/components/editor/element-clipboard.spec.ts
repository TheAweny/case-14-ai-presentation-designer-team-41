import { describe, expect, it } from 'vitest';
import type { SlideElement } from '@lct/contracts';
import {
  paragraphsOf,
  parseElements,
  pasteOffset,
  plainTextOf,
  serializeElements,
} from './element-clipboard';

const rect: SlideElement = {
  kind: 'decor',
  elementId: 'r',
  role: 'decoration',
  box: { x: 100, y: 100, cx: 50, cy: 50 },
  sourceShapeId: null,
  shape: 'rect',
  fill: 'accent',
  stroke: null,
};

const text: SlideElement = {
  kind: 'text',
  elementId: 't',
  role: 'body',
  box: { x: 0, y: 0, cx: 100, cy: 20 },
  sourceShapeId: null,
  paragraphs: paragraphsOf('Первая\nВторая'),
  overflow: null,
};

describe('element clipboard', () => {
  it('round-trips elements through the clipboard text', () => {
    expect(parseElements(serializeElements([rect, text]))).toEqual([rect, text]);
  });

  it('rejects foreign or broken data as a whole', () => {
    expect(parseElements('hello')).toBeNull();
    expect(parseElements(JSON.stringify({ version: 2, elements: [rect] }))).toBeNull();
    expect(
      parseElements(JSON.stringify({ version: 1, elements: [rect, { kind: 'x' }] })),
    ).toBeNull();
  });

  it('gives other programs the words of the copied text', () => {
    expect(plainTextOf([rect, text])).toBe('Первая\nВторая');
  });

  it('pastes in place on another slide and steps aside over the original', () => {
    expect(pasteOffset([], [rect], 10)).toEqual({ x: 0, y: 0 });
    expect(pasteOffset([rect], [rect], 10)).toEqual({ x: 10, y: 10 });
    const shifted = { ...rect, box: { ...rect.box, x: 110, y: 110 } };
    expect(pasteOffset([rect, shifted], [rect], 10)).toEqual({ x: 20, y: 20 });
  });

  it('splits plain text into paragraphs', () => {
    expect(paragraphsOf('a\r\nb').map((p) => p.runs[0]?.text)).toEqual(['a', 'b']);
  });
});
