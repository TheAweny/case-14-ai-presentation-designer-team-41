import { describe, expect, it } from 'vitest';
import type { SlideElement } from '@lct/contracts';
import { DEMO_DESIGN_SYSTEM } from '../../mocks/demo-deck/design-system';
import { canHoldText, shapeAsText, shapeTextFrame } from './shape-text';

type Decor = Extract<SlideElement, { kind: 'decor' }>;

const size = { cx: 12_192_000, cy: 6_858_000 };

const card: Decor = {
  kind: 'decor',
  elementId: 'card',
  role: 'decoration',
  box: { x: 0, y: 0, cx: 3_048_000, cy: 1_219_200 },
  sourceShapeId: null,
  shape: 'rect',
  fill: 'accent',
  stroke: null,
};

const body = DEMO_DESIGN_SYSTEM.typeScale.find((style) => style.role === 'body');

describe('shape text', () => {
  it('lets closed, unlocked shapes hold text, never a line or a locked shape', () => {
    expect(canHoldText(card)).toBe(true);
    expect(canHoldText({ ...card, shape: 'ellipse' })).toBe(true);
    expect(canHoldText({ ...card, shape: undefined })).toBe(true);
    expect(canHoldText({ ...card, shape: 'line' })).toBe(false);
    expect(canHoldText({ ...card, locked: true })).toBe(false);
    expect(canHoldText(undefined)).toBe(false);
  });

  it('opens an empty shape with one empty paragraph and a written one with its words', () => {
    const empty = shapeAsText(card);
    expect(empty).toMatchObject({ kind: 'text', elementId: 'card', role: 'body', box: card.box });
    expect(empty.paragraphs).toEqual([{ level: 0, runs: [], lineSpacing: null }]);
    const paragraphs = [
      {
        level: 0,
        lineSpacing: null,
        runs: [{ text: 'Шаг', font: '', sizePt: null, bold: null, italic: null, color: '' }],
      },
    ];
    expect(shapeAsText({ ...card, paragraphs }).paragraphs).toEqual(paragraphs);
  });

  it('centres the field both ways by default and reads on the fill', () => {
    const frame = shapeTextFrame(card, size, DEMO_DESIGN_SYSTEM);
    expect(frame.style).toMatchObject({ justifyContent: 'center', textAlign: 'center' });
    expect(frame.look.sizePt).toBe(body?.sizePt);
    // Белый text-on-accent на синем акценте, тёмный основной текст на светлой плашке.
    expect(frame.look.color).toBe('#FFFFFF');
    expect(shapeTextFrame({ ...card, fill: 'surface' }, size, DEMO_DESIGN_SYSTEM).look.color).toBe(
      '#16181D',
    );
    const bottom = shapeTextFrame({ ...card, verticalAlign: 'bottom' }, size, DEMO_DESIGN_SYSTEM);
    expect(bottom.style.justifyContent).toBe('flex-end');
  });
});
