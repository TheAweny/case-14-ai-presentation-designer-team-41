import { describe, expect, it } from 'vitest';
import { slideElementSchema, type Box, type DesignSystem, type Grid } from '@lct/contracts';
import { createImageElement, createInsertedElements, fitAspect, placedBox } from './insert-element';

const GRID: Grid = {
  slideCx: 12_192_000,
  slideCy: 6_858_000,
  marginLeft: 457_200,
  marginRight: 457_200,
  marginTop: 342_900,
  marginBottom: 342_900,
  columns: 12,
  gutter: 182_880,
  baseline: 114_300,
};

const EMU_PER_PT = 12_700;

const PROFILE: Pick<DesignSystem, 'typeScale'> = {
  typeScale: [
    {
      role: 'body',
      font: 'Inter',
      sizePt: 16,
      bold: false,
      italic: false,
      lineSpacing: 1.3,
      colorRole: 'text',
      source: 'observed',
    },
  ],
};

let seq = 0;
function ids(): string {
  seq += 1;
  return `id-${seq}`;
}

function click(): Box {
  return { x: 2_000_000, y: 1_000_000, cx: 10, cy: 10 };
}

const CONTENT = GRID.slideCx - GRID.marginLeft - GRID.marginRight;

describe('createInsertedElements', () => {
  it('кладёт текст высотой в строку роли body и проходит схему', () => {
    seq = 0;
    const [element] = createInsertedElements('text', click(), GRID, {
      nextId: ids,
      profile: PROFILE,
    });
    expect(element?.kind).toBe('text');
    expect(slideElementSchema.parse(element)).toEqual(element);
    if (!element) return;
    // 1,4 строки кегля 16 пт с прилипанием к сетке.
    expect(element.box.cy).toBe(
      Math.round((16 * EMU_PER_PT * 1.4) / GRID.baseline) * GRID.baseline,
    );
    expect(element.box.cx).toBeGreaterThan(CONTENT / 3);
    expect(element.box.cy % GRID.baseline).toBe(0);
    expect(element.elementId).toBe('id-1');
  });

  it('фигура по клику — квадрат примерно в шестую часть области контента', () => {
    seq = 0;
    for (const tool of ['rectangle', 'ellipse'] as const) {
      const [element] = createInsertedElements(tool, click(), GRID, ids);
      if (!element) throw new Error('нет элемента');
      expect(element.box.cx).toBe(element.box.cy);
      expect(element.box.cx).toBeGreaterThan(CONTENT / 8);
      expect(element.box.cx).toBeLessThan(CONTENT / 4);
      expect(element).toMatchObject({
        kind: 'decor',
        sourceShapeId: null,
        shape: tool === 'rectangle' ? 'rect' : 'ellipse',
        fill: 'accent',
        stroke: null,
      });
      // Вид фигуры лежит в поле, а не в идентификаторе.
      expect(element.elementId).not.toContain(tool);
      expect(element.elementId).not.toContain('editor:');
    }
  });

  it('график и таблица встают пропорцией 16:10 на несколько колонок', () => {
    seq = 0;
    for (const tool of ['chart', 'table'] as const) {
      const [element] = createInsertedElements(tool, click(), GRID, ids);
      if (!element) throw new Error('нет элемента');
      expect(element.box.cx / element.box.cy).toBeCloseTo(1.6, 1);
      expect(element.box.cx).toBeGreaterThan(CONTENT / 2);
      expect(slideElementSchema.parse(element)).toEqual(element);
    }
  });

  it('линия по клику горизонтальная, а стрелка — линия с наконечником в конце', () => {
    seq = 0;
    const [line] = createInsertedElements('line', click(), GRID, ids);
    expect(line).toMatchObject({
      kind: 'decor',
      shape: 'line',
      fill: null,
      stroke: { color: 'accent', dash: 'solid', head: 'none', tail: 'none' },
    });
    expect(line?.box.cy).toBe(0);
    expect(line?.box.cx).toBeGreaterThan(0);

    const [arrow] = createInsertedElements('arrow', click(), GRID, ids);
    expect(arrow).toMatchObject({ shape: 'line', stroke: { tail: 'arrow' } });
    for (const element of [line, arrow]) {
      expect(slideElementSchema.parse(element)).toEqual(element);
    }
  });

  it('линия, протянутая справа налево и снизу вверх, сохраняет направление', () => {
    seq = 0;
    const drag: Box = { x: 800_000, y: 800_000, cx: 2_000_000, cy: 1_000_000 };
    const [plain] = createInsertedElements('line', drag, GRID, { nextId: ids });
    const [back] = createInsertedElements('arrow', drag, GRID, {
      nextId: ids,
      reversedX: true,
      reversedY: true,
    });
    expect(plain).not.toHaveProperty('flipH');
    expect(plain?.box).toEqual(drag);
    expect(back).toMatchObject({ flipH: true, flipV: true, stroke: { tail: 'arrow' } });
    // Протяжка по диагонали остаётся диагональной: тонкую сторону больше не схлопывают.
    expect(back?.box).toEqual(drag);
  });

  it('схему собирает из трёх карточек и двух стрелок', () => {
    seq = 0;
    const elements = createInsertedElements('diagram', click(), GRID, ids);
    expect(elements).toHaveLength(5);
    expect(
      elements.map((element) => (element.kind === 'decor' ? element.shape : element.kind)),
    ).toEqual(['round-rect', 'round-rect', 'round-rect', 'line', 'line']);
    for (const element of elements.slice(3)) {
      expect(element).toMatchObject({ stroke: { tail: 'arrow' } });
    }
    for (const element of elements) expect(slideElementSchema.parse(element)).toEqual(element);
    expect(new Set(elements.map((element) => element.elementId)).size).toBe(5);
  });

  it('картинку кладёт рамкой под будущий файл', () => {
    seq = 0;
    const [element] = createInsertedElements('image', click(), GRID, ids);
    expect(element).toMatchObject({ kind: 'image', fit: 'contain', mediaPart: 'upload/id-1' });
    expect(slideElementSchema.parse(element)).toEqual(element);
  });
});

describe('placedBox', () => {
  it('не загоняет объект в поля сетки: поля — направляющие, а не ограда', () => {
    const outside: Box = { x: 0, y: 0, cx: 800_000, cy: 400_000 };
    expect(placedBox('rectangle', outside, GRID)).toEqual(outside);

    const overhang: Box = {
      x: GRID.slideCx - 200_000,
      y: GRID.slideCy - 100_000,
      cx: 1_000_000,
      cy: 600_000,
    };
    expect(placedBox('rectangle', overhang, GRID)).toEqual(overhang);
  });

  it('клик у самого края слайда ставит объект по центру точки', () => {
    const box = placedBox('rectangle', { x: 60_000, y: 40_000, cx: 10, cy: 10 }, GRID);
    expect(box.x).toBeLessThan(0);
    expect(Math.abs(box.x % GRID.baseline)).toBe(0);
    expect(Math.abs(box.y % GRID.baseline)).toBe(0);
  });
});

describe('fitAspect', () => {
  const target: Box = { x: 0, y: 0, cx: 1000, cy: 1000 };

  it('fits a wide picture inside the frame and centres it vertically', () => {
    expect(fitAspect(target, { width: 400, height: 200 })).toEqual({
      x: 0,
      y: 250,
      cx: 1000,
      cy: 500,
    });
  });

  it('fits a tall picture and centres it horizontally', () => {
    expect(fitAspect(target, { width: 100, height: 400 })).toEqual({
      x: 375,
      y: 0,
      cx: 250,
      cy: 1000,
    });
  });

  it('keeps the frame when the picture has no size', () => {
    expect(fitAspect(target, null)).toEqual(target);
  });
});

describe('createImageElement', () => {
  it('places a clicked picture at the default size in its own proportions', () => {
    const element = createImageElement(
      'upload/a.png',
      { x: 6_000_000, y: 3_000_000, cx: 0, cy: 0 },
      GRID,
      { width: 1600, height: 900 },
      { nextId: () => 'img' },
    );
    expect(slideElementSchema.parse(element)).toMatchObject({
      kind: 'image',
      elementId: 'img',
      mediaPart: 'upload/a.png',
      fit: 'contain',
      sourceShapeId: null,
    });
    expect(element.box.cx / element.box.cy).toBeCloseTo(16 / 9, 2);
  });
});
