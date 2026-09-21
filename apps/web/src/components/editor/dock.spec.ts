import { describe, expect, it } from 'vitest';
import {
  DOCK_MARGIN,
  clampToArea,
  dockAxis,
  dockPointFromRatio,
  dockRatioFromPoint,
  dockSideAt,
  dockSnapSide,
  dockZonePoint,
  parseDock,
  railSize,
  railSpan,
  type Size,
} from './dock';

/** Область примерно как холст на ноутбуке и панель в двух своих ориентациях. */
const AREA: Size = { width: 1200, height: 800 };
const VERTICAL: Size = { width: 52, height: 360 };
const HORIZONTAL: Size = { width: 360, height: 52 };

describe('dockZonePoint', () => {
  it('ставит панель у края и по центру этого края', () => {
    expect(dockZonePoint('left', AREA, VERTICAL)).toEqual({ x: DOCK_MARGIN, y: 220 });
    expect(dockZonePoint('right', AREA, VERTICAL)).toEqual({ x: 1200 - 52 - DOCK_MARGIN, y: 220 });
    expect(dockZonePoint('top', AREA, HORIZONTAL)).toEqual({ x: 420, y: DOCK_MARGIN });
    expect(dockZonePoint('bottom', AREA, HORIZONTAL)).toEqual({
      x: 420,
      y: 800 - 52 - DOCK_MARGIN,
    });
  });
});

describe('dockSideAt', () => {
  it('делит область на четыре сектора по долям её сторон', () => {
    expect(dockSideAt({ x: 40, y: 400 }, AREA)).toBe('left');
    expect(dockSideAt({ x: 1160, y: 400 }, AREA)).toBe('right');
    expect(dockSideAt({ x: 600, y: 30 }, AREA)).toBe('top');
    expect(dockSideAt({ x: 600, y: 770 }, AREA)).toBe('bottom');
  });

  it('у горизонтально растянутой области верх и низ ближе, чем кажется по пикселям', () => {
    // 120 пикселей от левого края — это 10% ширины, 120 от верхнего — уже 15% высоты.
    expect(dockSideAt({ x: 120, y: 120 }, AREA)).toBe('left');
  });
});

describe('dockSnapSide', () => {
  it('ловит панель у середины края', () => {
    const point = { x: 20, y: 210 };
    expect(dockSnapSide({ x: point.x + 26, y: point.y + 180 }, AREA, VERTICAL)).toBe('left');
  });

  it('не ловит панель в углу: там человек имел в виду свободное место', () => {
    expect(dockSnapSide({ x: 30, y: 40 }, AREA, VERTICAL)).toBeNull();
  });

  it('не ловит панель в середине области', () => {
    expect(dockSnapSide({ x: 600, y: 400 }, AREA, VERTICAL)).toBeNull();
  });

  it('ловит верхнюю зону по центру верхнего края', () => {
    expect(dockSnapSide({ x: 600, y: 45 }, AREA, HORIZONTAL)).toBe('top');
  });
});

describe('свободное положение', () => {
  it('переводит точку в доли и обратно без потерь', () => {
    const point = { x: 400, y: 300 };
    const ratio = dockRatioFromPoint(point, AREA, VERTICAL);
    expect(dockPointFromRatio(ratio, AREA, VERTICAL)).toEqual(point);
  });

  it('держит те же доли после изменения размеров области', () => {
    const ratio = dockRatioFromPoint({ x: 400, y: 300 }, AREA, VERTICAL);
    const narrow: Size = { width: 600, height: 500 };
    const moved = dockPointFromRatio(ratio, narrow, VERTICAL);
    expect(moved.x).toBeGreaterThanOrEqual(DOCK_MARGIN);
    expect(moved.x + VERTICAL.width).toBeLessThanOrEqual(narrow.width - DOCK_MARGIN);
    expect(moved.y + VERTICAL.height).toBeLessThanOrEqual(narrow.height - DOCK_MARGIN);
  });

  it('не выпускает панель за край области', () => {
    expect(clampToArea({ x: -400, y: 5000 }, AREA, VERTICAL)).toEqual({
      x: DOCK_MARGIN,
      y: 800 - 360 - DOCK_MARGIN,
    });
  });

  it('прижимает панель к углу, если она больше области', () => {
    const tiny: Size = { width: 60, height: 100 };
    expect(clampToArea({ x: 500, y: 500 }, tiny, VERTICAL)).toEqual({
      x: DOCK_MARGIN,
      y: DOCK_MARGIN,
    });
  });
});

describe('ориентация', () => {
  it('разворачивает панель вместе с зоной', () => {
    expect(dockAxis('left')).toBe('vertical');
    expect(dockAxis('bottom')).toBe('horizontal');
    const span = railSpan(VERTICAL, 'vertical');
    expect(span).toEqual({ main: 360, cross: 52 });
    expect(railSize(span, 'horizontal')).toEqual(HORIZONTAL);
  });
});

describe('parseDock', () => {
  it('читает своё же значение', () => {
    expect(parseDock('{"kind":"zone","side":"bottom"}')).toEqual({ kind: 'zone', side: 'bottom' });
    expect(parseDock('{"kind":"free","side":"top","x":0.25,"y":0.5}')).toEqual({
      kind: 'free',
      side: 'top',
      x: 0.25,
      y: 0.5,
    });
  });

  it('обрезает доли, вышедшие за пределы', () => {
    expect(parseDock('{"kind":"free","side":"top","x":-2,"y":9}')).toEqual({
      kind: 'free',
      side: 'top',
      x: 0,
      y: 1,
    });
  });

  it('не верит мусору', () => {
    expect(parseDock(null)).toBeNull();
    expect(parseDock('не json')).toBeNull();
    expect(parseDock('42')).toBeNull();
    expect(parseDock('{"kind":"zone","side":"middle"}')).toBeNull();
    expect(parseDock('{"kind":"free","side":"top"}')).toBeNull();
    expect(parseDock('{"kind":"free","side":"top","x":"0.5","y":0.5}')).toBeNull();
  });
});
