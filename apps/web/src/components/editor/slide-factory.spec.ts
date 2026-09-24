import { describe, expect, it } from 'vitest';
import type { SlideElement, SlideIr } from '@lct/contracts';
import { blankSlideFrom } from './slide-factory';

const box = { x: 0, y: 0, cx: 10, cy: 10 };
const run = { text: 'x', font: '', sizePt: null, bold: null, italic: null, color: '' };

function text(elementId: string, role: 'title' | 'footer' | 'page-number', source: number | null) {
  return {
    kind: 'text',
    elementId,
    role,
    box,
    sourceShapeId: source,
    paragraphs: [{ level: 0, runs: [run] }],
    overflow: null,
  } as SlideElement;
}

const base: SlideIr = {
  schemaVersion: 1,
  slideId: 'a',
  variant: 'balanced',
  index: 0,
  patternId: 'cover',
  slideCx: 100,
  slideCy: 50,
  elements: [
    { kind: 'decor', elementId: 'panel', role: 'decoration', box, sourceShapeId: 3 },
    text('title', 'title', 1),
    text('footer', 'footer', 2),
    text('number', 'page-number', 4),
    {
      kind: 'decor',
      elementId: 'drawn',
      role: 'decoration',
      box,
      sourceShapeId: null,
      shape: 'rect',
      fill: 'accent',
      stroke: null,
    },
  ],
} as SlideIr;

describe('blankSlideFrom', () => {
  it('keeps the template chrome and drops content and what the editor drew', () => {
    let n = 0;
    const slide = blankSlideFrom(base, 'b', () => `new-${(n += 1)}`);
    expect(slide.slideId).toBe('b');
    expect(slide.patternId).toBe('cover');
    expect(slide.elements.map((element) => element.role)).toEqual(['decoration', 'footer']);
    expect(slide.elements.map((element) => element.elementId)).toEqual(['new-1', 'new-2']);
  });

  it('leaves the source slide untouched', () => {
    blankSlideFrom(base, 'b');
    expect(base.elements).toHaveLength(5);
    expect(base.elements[0]?.elementId).toBe('panel');
  });
});
