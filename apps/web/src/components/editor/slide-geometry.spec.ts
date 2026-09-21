import { describe, expect, it } from 'vitest';
import type { Grid } from '@lct/contracts';
import { clampToMargins, gridGuidelines, nudgeByBaseline, pixelBoxToEmu } from './slide-geometry';

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

  it('places guides on margins, columns, gutters and baselines', () => {
    const guides = gridGuidelines(GRID, { width: 200, height: 100 });
    expect(guides.vertical).toContain(0);
    expect(guides.vertical).toContain(20);
    expect(guides.vertical).toContain(100);
    expect(guides.vertical).toContain(104);
    expect(guides.vertical).toContain(184);
    expect(guides.vertical).toContain(200);
    expect(guides.horizontal).toContain(0);
    expect(guides.horizontal).toContain(6.67);
    expect(guides.horizontal).toContain(100);
  });

  it('keeps a nudge inside the margins, one baseline at a time', () => {
    const box = { x: 100, y: 40, cx: 50, cy: 50 };
    expect(nudgeByBaseline(box, 'right', GRID)).toEqual({ x: 150, y: 40, cx: 50, cy: 50 });
    expect(nudgeByBaseline(box, 'left', GRID)).toEqual(box);
    expect(nudgeByBaseline(box, 'up', GRID)).toEqual(box);
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
