import { describe, expect, it } from 'vitest';
import {
  DOCK_MARGIN,
  clampToArea,
  dockAxis,
  dockPointFromRatio,
  dockRatioFromPoint,
  dockSideAt,
  dockSideOnAxis,
  dockSnapSide,
  dockZonePoint,
  dockZoneRect,
  parseDock,
  railSize,
  railSpan,
  type Size,
} from './dock';

/** Область примерно как холст на ноутбуке и панель в двух своих ориентациях. */
const AREA: Size = { width: 1200, height: 800 };
const VERTICAL: Size = { width: 52, height: 360 };
const HORIZONTAL: Size = { width: 360, height: 52 };
const SPAN = { main: 360, cross: 52 };

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

describe('dockZoneRect', () => {
  it('разворачивает след под ориентацию зоны', () => {
    expect(dockZoneRect('left', AREA, SPAN)).toEqual({ x: DOCK_MARGIN, y: 220, ...VERTICAL });
    expect(dockZoneRect('top', AREA, SPAN)).toEqual({ x: 420, y: DOCK_MARGIN, ...HORIZONTAL });
  });
});

describe('dockSnapSide', () => {
  // След левой зоны: x 12…64, y 220…580. След верхней: x 420…780, y 12…64.

  it('ловит панель, когда курсор над следом зоны', () => {
    expect(dockSnapSide({ x: 40, y: 400 }, AREA, SPAN)).toBe('left');
    expect(dockSnapSide({ x: 600, y: 40 }, AREA, SPAN)).toBe('top');
    expect(dockSnapSide({ x: 1170, y: 300 }, AREA, SPAN)).toBe('right');
    expect(dockSnapSide({ x: 450, y: 760 }, AREA, SPAN)).toBe('bottom');
  });

  it('прощает небольшой промах мимо следа', () => {
    expect(dockSnapSide({ x: 76, y: 400 }, AREA, SPAN)).toBe('left');
    expect(dockSnapSide({ x: 40, y: 210 }, AREA, SPAN)).toBe('left');
  });

  it('ловит курсор, ушедший за край области напротив следа', () => {
    expect(dockSnapSide({ x: -80, y: 400 }, AREA, SPAN)).toBe('left');
    expect(dockSnapSide({ x: 600, y: -30 }, AREA, SPAN)).toBe('top');
  });

  it('рядом со следом не ловит: панель встаёт туда, куда её поставили', () => {
    expect(dockSnapSide({ x: 100, y: 400 }, AREA, SPAN)).toBeNull();
    expect(dockSnapSide({ x: 40, y: 150 }, AREA, SPAN)).toBeNull();
    expect(dockSnapSide({ x: 600, y: 100 }, AREA, SPAN)).toBeNull();
  });

  it('не ловит панель в углу и в середине области', () => {
    expect(dockSnapSide({ x: 30, y: 40 }, AREA, SPAN)).toBeNull();
    expect(dockSnapSide({ x: 600, y: 400 }, AREA, SPAN)).toBeNull();
  });

  it('где следы перекрываются, выбирает тот, чей центр ближе', () => {
    // В тесной области левый след по высоте заходит на верхний.
    const tight: Size = { width: 400, height: 300 };
    expect(dockSnapSide({ x: 40, y: 40 }, tight, SPAN)).toBe('left');
    expect(dockSnapSide({ x: 100, y: 40 }, tight, SPAN)).toBe('top');
  });
});

describe('dockSideOnAxis', () => {
  it('сохраняет ориентацию и выбирает ближний край', () => {
    expect(dockSideOnAxis({ x: 300, y: 700 }, AREA, 'vertical')).toBe('left');
    expect(dockSideOnAxis({ x: 900, y: 100 }, AREA, 'vertical')).toBe('right');
    expect(dockSideOnAxis({ x: 900, y: 100 }, AREA, 'horizontal')).toBe('top');
    expect(dockSideOnAxis({ x: 300, y: 700 }, AREA, 'horizontal')).toBe('bottom');
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

describe('препятствия', () => {
  // Масштаб в правом нижнем углу холста: 72×32 в 12 px от краёв.
  const HUD = { x: 1200 - 12 - 72, y: 800 - 12 - 32, width: 72, height: 32 };

  it('без препятствий зона стоит по центру края', () => {
    expect(dockZonePoint('bottom', AREA, HORIZONTAL, [])).toEqual({ x: 420, y: 736 });
  });

  it('не трогает зону, которой препятствие не мешает', () => {
    expect(dockZonePoint('bottom', AREA, HORIZONTAL, [HUD])).toEqual({ x: 420, y: 736 });
    expect(dockZonePoint('left', AREA, VERTICAL, [HUD])).toEqual({ x: DOCK_MARGIN, y: 220 });
  });

  it('сдвигает нижнюю зону вдоль края, когда середину занимает угол с масштабом', () => {
    // Узкая область: панель по центру задела бы масштаб.
    const narrow: Size = { width: 480, height: 800 };
    const hud = { x: 480 - 12 - 72, y: 800 - 12 - 32, width: 72, height: 32 };
    const point = dockZonePoint('bottom', narrow, HORIZONTAL, [hud]);
    expect(point.y).toBe(800 - 52 - DOCK_MARGIN);
    expect(point.x + HORIZONTAL.width).toBeLessThanOrEqual(hud.x - 8);
    expect(point.x).toBeGreaterThanOrEqual(DOCK_MARGIN);
  });

  it('поднимает правую зону над масштабом в невысокой области', () => {
    const short: Size = { width: 1200, height: 460 };
    const hud = { x: 1200 - 12 - 72, y: 460 - 12 - 32, width: 72, height: 32 };
    const point = dockZonePoint('right', short, VERTICAL, [hud]);
    expect(point.x).toBe(1200 - 52 - DOCK_MARGIN);
    expect(point.y + VERTICAL.height).toBeLessThanOrEqual(hud.y - 8);
  });

  it('уводит свободную панель с препятствия по ближайшей оси', () => {
    const point = clampToArea({ x: 1130, y: 700 }, AREA, HORIZONTAL, [HUD]);
    const overlaps =
      point.x < HUD.x + HUD.width &&
      HUD.x < point.x + HORIZONTAL.width &&
      point.y < HUD.y + HUD.height &&
      HUD.y < point.y + HORIZONTAL.height;
    expect(overlaps).toBe(false);
    // Выше масштаба ближе, чем левее него.
    expect(point.y + HORIZONTAL.height).toBeLessThanOrEqual(HUD.y - 8);
  });

  it('в тесной области оставляет панель на месте, а не прячет', () => {
    const tiny: Size = { width: 380, height: 80 };
    const hud = { x: 380 - 12 - 72, y: 80 - 12 - 32, width: 72, height: 32 };
    const point = dockZonePoint('bottom', tiny, HORIZONTAL, [hud]);
    expect(point).toEqual({ x: 10, y: 80 - 52 - DOCK_MARGIN });
  });

  it('след зоны совпадает с местом, куда панель встанет', () => {
    const narrow: Size = { width: 480, height: 800 };
    const hud = { x: 480 - 12 - 72, y: 800 - 12 - 32, width: 72, height: 32 };
    const zone = dockZoneRect('bottom', narrow, SPAN, [hud]);
    expect({ x: zone.x, y: zone.y }).toEqual(dockZonePoint('bottom', narrow, HORIZONTAL, [hud]));
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
