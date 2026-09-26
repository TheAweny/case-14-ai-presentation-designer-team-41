import { describe, expect, it } from 'vitest';
import { slideIrSchema, type SlideElement, type SlideIr } from '@lct/contracts';
import type { SlideLayout } from '@/lib/deck-source';
import { BLANK_PATTERN_ID, layoutOf, slideFromLayout } from './slide-factory';

const box = { x: 0, y: 0, cx: 10, cy: 10 };

function slot(elementId: string, role: 'title' | 'body', source: number): SlideElement {
  return {
    kind: 'text',
    elementId,
    role,
    box,
    sourceShapeId: source,
    paragraphs: [{ level: 0, runs: [], lineSpacing: null }],
    overflow: null,
  };
}

const skeleton: SlideIr = {
  schemaVersion: 1,
  slideId: 'layout-two',
  variant: 'balanced',
  index: 0,
  patternId: 'two',
  slideCx: 100,
  slideCy: 50,
  elements: [
    { kind: 'decor', elementId: 'panel', role: 'decoration', box, sourceShapeId: 3, locked: true },
    slot('title', 'title', 1),
    slot('body', 'body', 2),
  ],
  notes: 'только для заготовки',
};

const layout: SlideLayout = { name: 'Два блока', slide: skeleton };
const deck = { variant: 'dense', slideCx: 100, slideCy: 50 } as const;

describe('slideFromLayout', () => {
  it('copies the layout skeleton with fresh ids and the deck variant', () => {
    let n = 0;
    const slide = slideFromLayout(layout, deck, 'b', () => `new-${(n += 1)}`);
    expect(slide.slideId).toBe('b');
    expect(slide.patternId).toBe('two');
    expect(slide.variant).toBe('dense');
    expect(slide.notes).toBeUndefined();
    expect(slide.elements.map((element) => element.role)).toEqual(['decoration', 'title', 'body']);
    expect(slide.elements.map((element) => element.elementId)).toEqual(['new-1', 'new-2', 'new-3']);
    expect(slideIrSchema.safeParse(slide).success).toBe(true);
  });

  it('leaves the layout untouched', () => {
    const slide = slideFromLayout(layout, deck, 'b');
    slide.elements.pop();
    expect(skeleton.elements).toHaveLength(3);
    expect(skeleton.elements[0]?.elementId).toBe('panel');
    expect(skeleton.notes).toBe('только для заготовки');
  });

  it('makes a blank slide of the deck size when there is no layout', () => {
    const slide = slideFromLayout(null, deck, 'b');
    expect(slide.patternId).toBe(BLANK_PATTERN_ID);
    expect(slide.elements).toEqual([]);
    expect([slide.slideCx, slide.slideCy]).toEqual([100, 50]);
    expect(slideIrSchema.safeParse(slide).success).toBe(true);
  });
});

describe('layoutOf', () => {
  it('finds the layout by the pattern of the slide', () => {
    expect(layoutOf({ ...skeleton, slideId: 'x' }, [layout])).toBe(layout);
  });

  it('has none for a blank slide or an unknown pattern', () => {
    expect(layoutOf({ ...skeleton, patternId: BLANK_PATTERN_ID }, [layout])).toBeNull();
    expect(layoutOf({ ...skeleton, patternId: 'kpi' }, [layout])).toBeNull();
  });
});
