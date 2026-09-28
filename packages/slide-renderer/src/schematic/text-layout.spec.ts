import { describe, expect, it } from 'vitest';
import { EMU_PER_PT } from '../geometry.js';
import { TYPE_SCALE, WIDE, box, paragraph, text } from '../testing/deck.js';
import { createTypeResolver, layoutText, type TextLayout } from './text-layout.js';

const type = createTypeResolver(undefined, WIDE.cy);

const LONG =
  'Генеративные сервисы хорошо пишут текст, но плохо повторяют структуру и дизайн шаблона, ' +
  'поэтому колоду в фирменном стиле всё равно доводит дизайнер вручную';

/** The item at `index`, failing the test when there is none. */
function nth<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`No item at ${index}`);
  return item;
}

function expectInside(layout: TextLayout, frame: { cx: number; cy: number }) {
  for (const bar of layout.bars) {
    expect(bar.x).toBeGreaterThanOrEqual(0);
    expect(bar.y).toBeGreaterThanOrEqual(0);
    expect(bar.x + bar.width).toBeLessThanOrEqual(frame.cx);
    expect(bar.y + bar.thickness).toBeLessThanOrEqual(frame.cy);
  }
  for (const marker of layout.markers) {
    expect(marker.x + marker.size).toBeLessThanOrEqual(frame.cx);
    expect(marker.y + marker.size).toBeLessThanOrEqual(frame.cy);
  }
}

describe('layoutText', () => {
  it('wraps long text in a narrow box to more lines than short text', () => {
    const narrow = box(0, 0, 200, 400);
    const long = layoutText(text('long', 'body', narrow, [paragraph(LONG)]), type);
    const short = layoutText(text('short', 'body', narrow, [paragraph('Коротко')]), type);
    expect(short.bars).toHaveLength(1);
    expect(long.bars.length).toBeGreaterThan(3);
    expect(long.estimatedLines).toBe(long.bars.length);
  });

  it('wraps the same text to fewer lines in a wider box', () => {
    const narrow = layoutText(text('n', 'body', box(0, 0, 200, 400), [paragraph(LONG)]), type);
    const wide = layoutText(text('w', 'body', box(0, 0, 800, 400), [paragraph(LONG)]), type);
    expect(wide.bars.length).toBeLessThan(narrow.bars.length);
  });

  it('keeps every line inside the box and cuts what does not fit', () => {
    const frame = box(0, 0, 180, 60);
    const layout = layoutText(text('cut', 'body', frame, [paragraph(LONG)]), type);
    expectInside(layout, frame);
    expect(layout.bars.length).toBeGreaterThan(0);
    expect(layout.bars.length).toBeLessThan(layout.estimatedLines);
  });

  it('gives a full line the width of the box and the last line only what is left', () => {
    const frame = box(0, 0, 240, 400);
    const layout = layoutText(text('rag', 'body', frame, [paragraph(LONG)]), type);
    const widths = layout.bars.map((bar) => bar.width);
    const last = widths.at(-1) ?? 0;
    expect(Math.max(...widths)).toBeGreaterThan(frame.cx * 0.8);
    expect(last).toBeLessThan(Math.max(...widths));
  });

  it('draws larger type as thicker lines on a longer pitch', () => {
    const frame = box(0, 0, 400, 300);
    const small = layoutText(text('s', 'body', frame, [paragraph(LONG, { sizePt: 14 })]), type);
    const large = layoutText(text('l', 'body', frame, [paragraph(LONG, { sizePt: 28 })]), type);
    const [s0, s1] = [nth(small.bars, 0), nth(small.bars, 1)];
    const [l0, l1] = [nth(large.bars, 0), nth(large.bars, 1)];
    expect(l0.thickness).toBeGreaterThan(s0.thickness);
    expect(l1.y - l0.y).toBeGreaterThan(s1.y - s0.y);
  });

  it('gives each list item a marker and indents nested items', () => {
    const frame = box(0, 0, 300, 200);
    const layout = layoutText(
      text('list', 'bullet-list', frame, [
        paragraph('Первый'),
        paragraph('Вложенный', { level: 1 }),
        paragraph('Второй'),
      ]),
      type,
    );
    expect(layout.markers).toHaveLength(3);
    const [top, nested] = [nth(layout.markers, 0), nth(layout.markers, 1)];
    expect(nested.x).toBeGreaterThan(top.x);
    expect(nth(layout.bars, 1).x).toBeGreaterThan(nth(layout.bars, 0).x);
    expect(nth(layout.bars, 0).x).toBeGreaterThan(top.x + top.size);
    expectInside(layout, frame);
  });

  it('takes inherited sizes and spacing from the type scale', () => {
    const frame = box(0, 0, 200, 400);
    const element = text('inherited', 'body', frame, [paragraph(LONG, { sizePt: null })]);
    const resolved = layoutText(element, createTypeResolver(TYPE_SCALE, WIDE.cy));
    const [first, second] = [nth(resolved.bars, 0), nth(resolved.bars, 1)];
    expect(first.thickness).toBeCloseTo(20 * EMU_PER_PT * 0.5, 6);
    // 1.5 times single spacing, which is 1.2 of the size.
    expect(second.y - first.y).toBeCloseTo(20 * EMU_PER_PT * 1.5 * 1.2, 6);
  });

  it('takes the line spacing a paragraph states over the one of its type role', () => {
    const frame = box(0, 0, 200, 4000);
    const resolver = createTypeResolver(TYPE_SCALE, WIDE.cy);
    const stated = { ...paragraph(LONG, { sizePt: null }), lineSpacing: 3 };
    const layout = layoutText(text('spaced', 'body', frame, [stated]), resolver);
    const [first, second] = [nth(layout.bars, 0), nth(layout.bars, 1)];
    expect(second.y - first.y).toBeCloseTo(20 * EMU_PER_PT * 3 * 1.2, 6);
  });

  it('lets a wider line spacing push lines out of the box', () => {
    const frame = box(0, 0, 200, 120);
    const plain = layoutText(text('p', 'body', frame, [paragraph(LONG)]), type);
    const spaced = layoutText(
      text('s', 'body', frame, [{ ...paragraph(LONG), lineSpacing: 2.5 }]),
      type,
    );
    expect(spaced.estimatedLines).toBe(plain.estimatedLines);
    expect(spaced.bars.length).toBeLessThan(plain.bars.length);
  });

  it('wraps tracked-out text to more lines and tight text to fewer', () => {
    const frame = box(0, 0, 240, 4000);
    const tracked = (letterSpacingPt: number | null) => {
      const base = paragraph(LONG);
      const runs = base.runs.map((run) => ({ ...run, letterSpacingPt }));
      return layoutText(text('t', 'body', frame, [{ ...base, runs }]), type).estimatedLines;
    };
    expect(tracked(null)).toBe(tracked(0));
    expect(tracked(4)).toBeGreaterThan(tracked(0));
    expect(tracked(-2)).toBeLessThan(tracked(0));
  });

  it('never measures a glyph narrower than nothing, however tight the tracking', () => {
    const base = paragraph('Коротко');
    const runs = base.runs.map((run) => ({ ...run, letterSpacingPt: -500 }));
    const layout = layoutText(text('t', 'body', box(0, 0, 400, 200), [{ ...base, runs }]), type);
    expect(layout.estimatedLines).toBe(1);
    for (const bar of layout.bars) expect(bar.width).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic', () => {
    const element = text('same', 'body', box(0, 0, 300, 300), [paragraph(LONG)]);
    expect(layoutText(element, type)).toEqual(layoutText(element, type));
  });

  it('keeps an explicit line break and an empty paragraph as lines', () => {
    const layout = layoutText(
      text('breaks', 'body', box(0, 0, 600, 300), [paragraph('Раз\nдва'), paragraph('')]),
      type,
    );
    expect(layout.estimatedLines).toBe(3);
    expect(layout.bars).toHaveLength(2);
  });
});
