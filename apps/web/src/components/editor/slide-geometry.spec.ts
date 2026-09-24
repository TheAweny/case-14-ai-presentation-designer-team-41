import { describe, expect, it } from 'vitest';
import type { Grid } from '@lct/contracts';
import {
  alignBoxes,
  clampToMargins,
  distributeBoxes,
  gridGuidelines,
  nudgeBox,
  pixelBoxToEmu,
  placeSelectionBar,
  SELECTION_BAR_CLEARANCE,
  angleBetween,
  boxContains,
  constrainedEnd,
  lineEnds,
  lineFromEnds,
  resizedBox,
  rotatedBounds,
  snapValue,
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
      resizedBox(box, { dist: [20, 10], direction: [1, 1], translate: [10, 5] }, frame, 1000, 600, {
        anchored: false,
      }),
    ).toEqual({ x: 150, y: 90, cx: 300, cy: 180 });
  });

  it('grows about the centre with Alt, both sides moving by half', () => {
    // Ручка справа, ширина +40 px кадра от центра: оба края уходят на половину прироста.
    const wide = resizedBox(
      box,
      { dist: [40, 0], direction: [1, 0], translate: [0, 0] },
      frame,
      1000,
      600,
      { fromCenter: true },
    );
    expect(wide).toEqual({ x: 0, y: 60, cx: 400, cy: 120 });
    expect(wide.x + wide.cx / 2).toBe(box.x + box.cx / 2);
    const corner = resizedBox(
      box,
      { dist: [20, 20], direction: [-1, -1], translate: [0, 0] },
      frame,
      1000,
      600,
      { fromCenter: true },
    );
    expect(corner).toEqual({ x: 50, y: 0, cx: 300, cy: 240 });
  });

  it('holds the ratio in EMU when asked, led by the axis the handle pulls', () => {
    const square = { x: 0, y: 0, cx: 300, cy: 200 };
    // Правый край: ширина ведёт, высота следует за ней и растёт от середины.
    expect(
      resizedBox(
        square,
        { dist: [60, 41], direction: [1, 0], translate: [0, 0] },
        frame,
        1000,
        600,
        { keepRatio: true },
      ),
    ).toEqual({ x: 0, y: -100, cx: 600, cy: 400 });
    // Угол: ведёт ось, которая изменилась сильнее.
    expect(
      resizedBox(
        square,
        { dist: [3, 20], direction: [1, 1], translate: [0, 0] },
        frame,
        1000,
        600,
        { keepRatio: true },
      ),
    ).toEqual({ x: 0, y: 0, cx: 480, cy: 320 });
  });

  it('keeps the fixed side of a turned box where it is on the slide', () => {
    // Повёрнут на 90°: его «левый» край на экране сверху. Тянем «правый» (нижний на экране).
    const turned = { x: 100, y: 100, cx: 200, cy: 100 };
    const grown = resizedBox(
      turned,
      { dist: [20, 0], direction: [1, 0], translate: [0, 0] },
      frame,
      1000,
      600,
      { rotation: 90 },
    );
    expect(grown.cx).toBe(300);
    // Центр съехал вниз на половину прироста, по горизонтали остался.
    expect(grown.x + grown.cx / 2).toBe(200);
    expect(grown.y + grown.cy / 2).toBe(200);
    // Без поворота то же правило, что и раньше: левый край на месте.
    expect(
      resizedBox(
        turned,
        { dist: [20, 0], direction: [1, 0], translate: [0, 0] },
        frame,
        1000,
        600,
        { rotation: 360 },
      ),
    ).toEqual({ x: 100, y: 100, cx: 300, cy: 100 });
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

describe('distributing boxes', () => {
  const row = [
    { elementId: 'c', box: { x: 700, y: 0, cx: 100, cy: 50 } },
    { elementId: 'a', box: { x: 0, y: 0, cx: 100, cy: 50 } },
    { elementId: 'b', box: { x: 150, y: 90, cx: 200, cy: 50 } },
  ];

  it('makes the gaps between neighbours equal and keeps the outer boxes', () => {
    // Span 0..800, boxes take 400, two gaps of 200.
    expect(distributeBoxes(row, 'horizontal')).toEqual([
      { elementId: 'b', box: { x: 300, y: 90, cx: 200, cy: 50 } },
    ]);
  });

  it('works down the slide the same way', () => {
    const column = row.map(({ elementId, box }) => ({
      elementId,
      box: { x: box.y, y: box.x, cx: box.cy, cy: box.cx },
    }));
    expect(distributeBoxes(column, 'vertical')).toEqual([
      { elementId: 'b', box: { x: 90, y: 300, cx: 50, cy: 200 } },
    ]);
  });

  it('leaves evenly spaced boxes alone', () => {
    const even = [
      { elementId: 'a', box: { x: 0, y: 0, cx: 100, cy: 50 } },
      { elementId: 'b', box: { x: 200, y: 0, cx: 100, cy: 50 } },
      { elementId: 'c', box: { x: 400, y: 0, cx: 100, cy: 50 } },
    ];
    expect(distributeBoxes(even, 'horizontal')).toEqual([]);
  });

  it('needs at least three boxes', () => {
    expect(distributeBoxes(row.slice(0, 2), 'horizontal')).toEqual([]);
  });

  it('lets boxes overlap when they are wider than the span', () => {
    const tight = [
      { elementId: 'a', box: { x: 0, y: 0, cx: 100, cy: 10 } },
      { elementId: 'b', box: { x: 10, y: 0, cx: 100, cy: 10 } },
      { elementId: 'c', box: { x: 50, y: 0, cx: 100, cy: 10 } },
    ];
    // Span 0..150 holds 300 of boxes: each gap is -75.
    expect(distributeBoxes(tight, 'horizontal')).toEqual([
      { elementId: 'b', box: { x: 25, y: 0, cx: 100, cy: 10 } },
    ]);
  });
});

describe('rotated bounds', () => {
  const box = { x: 100, y: 100, cx: 200, cy: 100 };

  it('is the box itself without rotation or at a half turn', () => {
    expect(rotatedBounds(box)).toEqual(box);
    expect(rotatedBounds(box, 180)).toEqual(box);
  });

  it('swaps the sides at a quarter turn about the centre', () => {
    expect(rotatedBounds(box, 90)).toEqual({ x: 150, y: 50, cx: 100, cy: 200 });
    expect(rotatedBounds(box, 270)).toEqual({ x: 150, y: 50, cx: 100, cy: 200 });
  });

  it('grows to hold the corners at an angle', () => {
    const turned = rotatedBounds({ x: 0, y: 0, cx: 100, cy: 100 }, 45);
    expect(turned).toEqual({ x: -21, y: -21, cx: 141, cy: 141 });
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

  it('keeps its clearance from the selection clear of the rotation zones', () => {
    const selection = { x: 100, y: 100, width: 200, height: 80 };
    const above = placeSelectionBar(selection, bar, area, 8, SELECTION_BAR_CLEARANCE);
    expect(selection.y - (above.y + bar.height)).toBe(SELECTION_BAR_CLEARANCE);
    const low = placeSelectionBar({ ...selection, y: -20 }, bar, area, 8, SELECTION_BAR_CLEARANCE);
    expect(low).toEqual({ x: 140, y: 60 + SELECTION_BAR_CLEARANCE, below: true });
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

describe('line ends', () => {
  const box = { x: 100, y: 200, cx: 400, cy: 100 };

  it('runs from the top left to the bottom right, and flips swap the ends', () => {
    expect(lineEnds(box)).toEqual({ from: { x: 100, y: 200 }, to: { x: 500, y: 300 } });
    expect(lineEnds(box, { flipH: true })).toEqual({
      from: { x: 500, y: 200 },
      to: { x: 100, y: 300 },
    });
    expect(lineEnds(box, { flipV: true })).toEqual({
      from: { x: 100, y: 300 },
      to: { x: 500, y: 200 },
    });
  });

  it('turns the ends about the centre of the box', () => {
    const { from, to } = lineEnds({ x: 0, y: 0, cx: 200, cy: 0 }, {}, 90);
    expect(from.x).toBeCloseTo(100);
    expect(from.y).toBeCloseTo(-100);
    expect(to.x).toBeCloseTo(100);
    expect(to.y).toBeCloseTo(100);
  });

  it('gives back the box and flips for any two ends, keeping which end is which', () => {
    for (const flip of [{}, { flipH: true }, { flipV: true }, { flipH: true, flipV: true }]) {
      const { from, to } = lineEnds(box, flip);
      expect(lineFromEnds(from, to)).toEqual({
        box,
        flipH: flip.flipH === true,
        flipV: flip.flipV === true,
      });
    }
    // Конец протащили левее и выше начала: линия развернулась, рамка снова положительная.
    expect(lineFromEnds({ x: 500, y: 300 }, { x: 100, y: 250 })).toEqual({
      box: { x: 100, y: 250, cx: 400, cy: 50 },
      flipH: true,
      flipV: true,
    });
  });

  it('holds a horizontal rule at zero height', () => {
    expect(lineFromEnds({ x: 0, y: 50 }, { x: 300, y: 50 })).toEqual({
      box: { x: 0, y: 50, cx: 300, cy: 0 },
      flipH: false,
      flipV: false,
    });
  });

  it('with Shift lays the end on a multiple of 45 degrees', () => {
    const anchor = { x: 0, y: 0 };
    expect(constrainedEnd(anchor, { x: 100, y: 12 })).toEqual({ x: 100, y: 0 });
    expect(constrainedEnd(anchor, { x: -8, y: 90 })).toEqual({ x: 0, y: 90 });
    const diagonal = constrainedEnd(anchor, { x: 100, y: 90 });
    expect(diagonal.x).toBeCloseTo(95);
    expect(diagonal.y).toBeCloseTo(95);
  });

  it('snaps a value to the nearest candidate within reach', () => {
    expect(snapValue(103, [0, 100, 105], 4)).toBe(105);
    expect(snapValue(110, [0, 100], 4)).toBe(110);
  });

  it('measures the angle clockwise from the right', () => {
    expect(angleBetween({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe(90);
    expect(angleBetween({ x: 0, y: 0 }, { x: -10, y: 0 })).toBe(180);
    expect(angleBetween({ x: 0, y: 0 }, { x: 10, y: -10 })).toBe(315);
  });
});

describe('point in a box', () => {
  const box = { x: 0, y: 0, cx: 200, cy: 20 };

  it('finds a point inside a box and misses one outside', () => {
    expect(boxContains(box, { x: 150, y: 10 })).toBe(true);
    expect(boxContains(box, { x: 150, y: 30 })).toBe(false);
  });

  it('turns the box before it looks', () => {
    // Повёрнутая на 90° полоса стоит вертикально вокруг своего центра (100, 10).
    expect(boxContains(box, { x: 100, y: 80 }, 90)).toBe(true);
    expect(boxContains(box, { x: 180, y: 10 }, 90)).toBe(false);
  });
});
