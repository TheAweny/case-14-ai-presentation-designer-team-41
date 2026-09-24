import { describe, expect, it } from 'vitest';
import type { Grid } from '@lct/contracts';
import {
  alignBoxes,
  clampToMargins,
  gridGuidelines,
  nudgeBox,
  pixelBoxToEmu,
  placeSelectionBar,
  resizedBox,
  slidePixels,
  translatedBox,
  unionBox,
} from './slide-geometry';
import { tokenMeta } from '../../mocks/demo-deck/token-meta';

const GRID: Grid = {
  slideCx: 1000,
  slideCy: 600,
  marginLeft: 100,
  marginRight: 80,
  marginTop: 40,
  marginBottom: 40,
  columns: 2,
  gutter: 20,
  baseline: 50,
  meta: tokenMeta('fallback'),
};

describe('slide geometry', () => {
  it('turns a pixel box into EMU of the slide', () => {
    expect(
      pixelBoxToEmu(
        { x: 20, y: 10, width: 40, height: 20 },
        { width: 200, height: 100 },
        1000,
        600,
      ),
    ).toEqual({
      x: 100,
      y: 60,
      cx: 200,
      cy: 120,
    });
  });

  it('places guides on slide edges and centre, margins, columns and gutters', () => {
    const guides = gridGuidelines(GRID, { width: 200, height: 100 });
    expect(guides.vertical).toContain(0);
    expect(guides.vertical).toContain(20);
    expect(guides.vertical).toContain(100);
    expect(guides.vertical).toContain(104);
    expect(guides.vertical).toContain(184);
    expect(guides.vertical).toContain(200);
    expect(guides.horizontal).toEqual([0, 6.67, 50, 93.33, 100]);
  });

  it('draws no guide on every baseline', () => {
    const guides = gridGuidelines(GRID, { width: 200, height: 100 });
    // Шаг baseline здесь — 8,33 px: направляющей на каждом из них быть не должно.
    expect(guides.horizontal).not.toContain(15);
    expect(guides.horizontal.length).toBeLessThan(8);
  });

  it('shifts the guides to where the frame starts', () => {
    const guides = gridGuidelines(GRID, { width: 200, height: 100 }, { x: 30, y: 10 });
    expect(guides.vertical).toContain(30);
    expect(guides.vertical).toContain(230);
    expect(guides.horizontal).toContain(60);
  });

  it('moves a box one step in the direction of the arrow and nowhere else', () => {
    const box = { x: 100, y: 40, cx: 50, cy: 50 };
    expect(nudgeBox(box, 'right', GRID)).toEqual({ x: 150, y: 40, cx: 50, cy: 50 });
    expect(nudgeBox(box, 'up', GRID)).toEqual({ x: 100, y: -10, cx: 50, cy: 50 });
    expect(nudgeBox(box, 'left', GRID)).toEqual({ x: 50, y: 40, cx: 50, cy: 50 });
  });

  it('takes a wider step with Shift, still on the grid', () => {
    const box = { x: 100, y: 40, cx: 50, cy: 50 };
    expect(nudgeBox(box, 'down', GRID, true)).toEqual({ x: 100, y: 240, cx: 50, cy: 50 });
  });

  it('does not shrink a shape that is already wider than the content area', () => {
    expect(clampToMargins({ x: -20, y: 10, cx: 900, cy: 40 }, GRID)).toEqual({
      x: 0,
      y: 40,
      cx: 900,
      cy: 40,
    });
  });
});

describe('gesture to box', () => {
  const frame = { width: 200, height: 100 };
  const box = { x: 100, y: 60, cx: 200, cy: 120 };

  it('moves a box by the translate of the gesture', () => {
    expect(translatedBox(box, [10, -6], frame, 1000, 600)).toEqual({
      x: 150,
      y: 24,
      cx: 200,
      cy: 120,
    });
  });

  it('keeps the far side of a resized box exactly where it was', () => {
    const grown = resizedBox(
      box,
      { dist: [20, 10], direction: [1, 1], translate: [0, 0] },
      frame,
      1000,
      600,
    );
    expect(grown).toEqual({ x: 100, y: 60, cx: 300, cy: 180 });
    const pulled = resizedBox(
      box,
      { dist: [20, 10], direction: [-1, -1], translate: [-20, -10] },
      frame,
      1000,
      600,
    );
    expect(pulled.x + pulled.cx).toBe(box.x + box.cx);
    expect(pulled.y + pulled.cy).toBe(box.y + box.cy);
  });

  it('does not drift when a resize repeats', () => {
    let current = box;
    for (let step = 0; step < 5; step += 1) {
      current = resizedBox(
        current,
        { dist: [4, 0], direction: [1, 1], translate: [0, 0] },
        frame,
        1000,
        600,
      );
    }
    // Пять шагов по 4 px: высота и левый верхний угол не сдвинулись ни на один EMU.
    expect(current).toEqual({ x: 100, y: 60, cx: 300, cy: 120 });
  });

  it('follows the translate for a box resized as part of a group', () => {
    expect(
      resizedBox(
        box,
        { dist: [20, 10], direction: [1, 1], translate: [10, 5] },
        frame,
        1000,
        600,
        false,
      ),
    ).toEqual({ x: 150, y: 90, cx: 300, cy: 180 });
  });

  it('tells a screen distance in pixels of the slide itself', () => {
    expect(slidePixels(64, 640, 12192000)).toBe(128);
  });
});

describe('alignment', () => {
  const items = [
    { elementId: 'a', box: { x: 100, y: 50, cx: 200, cy: 100 } },
    { elementId: 'b', box: { x: 400, y: 300, cx: 100, cy: 50 } },
  ];

  it('bounds every box', () => {
    expect(unionBox(items.map((item) => item.box))).toEqual({ x: 100, y: 50, cx: 400, cy: 300 });
    expect(unionBox([])).toBeNull();
  });

  it('lines boxes up on an edge and leaves out the ones already there', () => {
    expect(alignBoxes(items, 'left')).toEqual([
      { elementId: 'b', box: { x: 100, y: 300, cx: 100, cy: 50 } },
    ]);
    expect(alignBoxes(items, 'bottom')).toEqual([
      { elementId: 'a', box: { x: 100, y: 250, cx: 200, cy: 100 } },
    ]);
  });

  it('centres boxes on the axis of their common bounds', () => {
    expect(alignBoxes(items, 'center')).toEqual([
      { elementId: 'a', box: { x: 200, y: 50, cx: 200, cy: 100 } },
      { elementId: 'b', box: { x: 250, y: 300, cx: 100, cy: 50 } },
    ]);
  });

  it('does nothing with a single box', () => {
    expect(alignBoxes(items.slice(0, 1), 'right')).toEqual([]);
  });
});

describe('selection bar', () => {
  const area = { x: -50, y: -60, width: 600, height: 400 };
  const bar = { width: 120, height: 40 };

  it('sits centred above the selection when there is room', () => {
    expect(placeSelectionBar({ x: 100, y: 100, width: 200, height: 80 }, bar, area, 8)).toEqual({
      x: 140,
      y: 52,
      below: false,
    });
  });

  it('goes below a selection at the top of the area', () => {
    expect(placeSelectionBar({ x: 100, y: -40, width: 200, height: 80 }, bar, area, 8)).toEqual({
      x: 140,
      y: 48,
      below: true,
    });
  });

  it('stays inside the area next to its edge', () => {
    expect(
      placeSelectionBar({ x: -45, y: 100, width: 20, height: 20 }, bar, area, 8),
    ).toMatchObject({
      x: -42,
    });
    expect(placeSelectionBar({ x: 100, y: -55, width: 200, height: 390 }, bar, area, 8)).toEqual({
      x: 140,
      y: 292,
      below: true,
    });
  });
});
