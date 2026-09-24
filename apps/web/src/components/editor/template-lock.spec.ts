import { describe, expect, it } from 'vitest';
import type { SlideIr } from '@lct/contracts';
import { lockTemplateDecor } from './template-lock';

const box = { x: 0, y: 0, cx: 1, cy: 1 };

const slide = {
  schemaVersion: 1,
  slideId: 's',
  variant: 'balanced',
  index: 0,
  patternId: 'p',
  slideCx: 10,
  slideCy: 10,
  elements: [
    { kind: 'decor', elementId: 'panel', role: 'decoration', box, sourceShapeId: 1 },
    { kind: 'decor', elementId: 'open', role: 'decoration', box, sourceShapeId: 2, locked: false },
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

describe('lockTemplateDecor', () => {
  it('locks template decoration that states no lock, and nothing else', () => {
    const [next] = lockTemplateDecor([slide]);
    expect(next?.elements.map((element) => element.locked)).toEqual([true, false, undefined]);
  });

  it('returns a slide with nothing to lock as it was', () => {
    const plain = { ...slide, elements: [slide.elements[2]] } as SlideIr;
    expect(lockTemplateDecor([plain])[0]).toBe(plain);
  });
});
