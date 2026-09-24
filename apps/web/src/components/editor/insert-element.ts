import type { Box, DesignSystem, Grid, SlideElement, Stroke } from '@lct/contracts';

/** Инструменты рейки, которые кладут новый объект на слайд. */
export const INSERT_TOOLS = [
  'text',
  'image',
  'rectangle',
  'ellipse',
  'line',
  'arrow',
  'chart',
  'table',
  'diagram',
] as const;

export type InsertTool = (typeof INSERT_TOOLS)[number];

type ShapeName = NonNullable<Extract<SlideElement, { kind: 'decor' }>['shape']>;

/** Инструмент рейки — фигура контракта. Стрелка это линия с наконечником в конце. */
const SHAPE_OF: Partial<Record<InsertTool, ShapeName>> = {
  rectangle: 'rect',
  ellipse: 'ellipse',
  line: 'line',
  arrow: 'line',
};

const EMU_PER_PT = 12_700;

/** Толщина линии по умолчанию. Редакторская константа, а не свойство шаблона. */
const STROKE_PT = 2;

/** Высота текстовой рамки: строка кегля роли body с интерлиньяжем. */
const TEXT_LINE = 1.4;

/** Доля ширины области контента у новой фигуры: сторона квадрата. */
const SHAPE_COLUMNS = 6;

/** График и таблица: 16:10 на семь колонок из двенадцати. */
const DATA_COLUMNS = 7;
const DATA_RATIO = 10 / 16;

export function isInsertTool(tool: string): tool is InsertTool {
  return (INSERT_TOOLS as readonly string[]).includes(tool);
}

/** Что редактор знает о вставке, кроме сетки: шкала кеглей и направление протяжки. */
export interface InsertOptions {
  /** Источник идентификаторов. По умолчанию — случайный UUID браузера. */
  readonly nextId?: () => string;
  /** Профиль шаблона: кегль роли body задаёт высоту новой текстовой рамки. */
  readonly profile?: Pick<DesignSystem, 'typeScale'>;
  /** Протяжка шла справа налево: линия сохраняет направление. */
  readonly reversedX?: boolean;
  /** Протяжка шла снизу вверх. */
  readonly reversedY?: boolean;
}

function optionsOf(options: InsertOptions | (() => string)): InsertOptions {
  return typeof options === 'function' ? { nextId: options } : options;
}

function contentWidth(grid: Grid): number {
  return Math.max(1, grid.slideCx - grid.marginLeft - grid.marginRight);
}

function columnSpan(grid: Grid, columns: number): number {
  const count = Math.max(grid.columns, 1);
  const width = (contentWidth(grid) - grid.gutter * (count - 1)) / count;
  const used = Math.min(Math.max(columns, 1), count);
  return Math.max(1, Math.round(width * used + grid.gutter * (used - 1)));
}

/** Кегль роли body из профиля. Без профиля — доля высоты слайда, как у рендерера. */
function bodySizeEmu(grid: Grid, profile: InsertOptions['profile']): number {
  const style = profile?.typeScale.find((entry) => entry.role === 'body');
  return style ? style.sizePt * EMU_PER_PT : grid.slideCy * 0.03;
}

/** К ближайшему шагу сетки, но не меньше одного шага. */
function snap(value: number, step: number): number {
  if (step <= 0) return Math.max(1, Math.round(value));
  return Math.max(step, Math.round(value / step) * step);
}

function defaultSize(
  tool: InsertTool,
  grid: Grid,
  profile: InsertOptions['profile'],
): { cx: number; cy: number } {
  const step = grid.baseline;
  switch (tool) {
    case 'text': {
      const cx = columnSpan(grid, 6);
      return { cx, cy: snap(bodySizeEmu(grid, profile) * TEXT_LINE, step) };
    }
    case 'image': {
      const cx = columnSpan(grid, 4);
      return { cx, cy: snap(cx * DATA_RATIO, step) };
    }
    case 'chart':
    case 'table':
    case 'diagram': {
      const cx = columnSpan(grid, DATA_COLUMNS);
      return { cx, cy: snap(cx * DATA_RATIO, step) };
    }
    case 'line':
    case 'arrow':
      // Линия по клику — горизонтальная: у неё нет высоты, как у коннектора в OOXML.
      return { cx: snap(contentWidth(grid) / 4, step), cy: 0 };
    default: {
      const side = snap(contentWidth(grid) / SHAPE_COLUMNS, step);
      return { cx: side, cy: side };
    }
  }
}

/** Клик, а не протяжка: обе стороны короче одного шага сетки. */
function clicked(box: Box, grid: Grid): boolean {
  return box.cx < grid.baseline && box.cy < grid.baseline;
}

function centered(box: Box, size: { cx: number; cy: number }, grid: Grid): Box {
  const cx = Math.max(0, Math.round(size.cx));
  const cy = Math.max(0, Math.round(size.cy));
  const step = Math.max(1, grid.baseline);
  return {
    x: Math.round((box.x + box.cx / 2 - cx / 2) / step) * step,
    y: Math.round((box.y + box.cy / 2 - cy / 2) / step) * step,
    cx,
    cy,
  };
}

/**
 * Рамка, которую попросил жест. Клик берёт размер по умолчанию и встаёт по центру точки,
 * протяжка остаётся как есть. Поля сетки — направляющие, а не ограничение: объект можно
 * положить и за ними, это забота аудита, а не редактора.
 */
export function placedBox(
  tool: InsertTool,
  drag: Box,
  grid: Grid,
  profile?: InsertOptions['profile'],
): Box {
  const box = clicked(drag, grid)
    ? centered(drag, defaultSize(tool, grid, profile), grid)
    : { ...drag };
  box.cx = Math.max(0, Math.round(box.cx));
  box.cy = Math.max(0, Math.round(box.cy));
  if (tool !== 'line' && tool !== 'arrow') {
    box.cx = Math.max(1, box.cx);
    box.cy = Math.max(1, box.cy);
  }
  box.x = Math.round(box.x);
  box.y = Math.round(box.y);
  return box;
}

function run() {
  return { text: '', font: '', sizePt: null, bold: null, italic: null, color: '' };
}

function stroke(tail: 'none' | 'arrow'): Stroke {
  return {
    color: 'accent',
    widthEmu: STROKE_PT * EMU_PER_PT,
    dash: 'solid',
    head: 'none',
    tail,
  };
}

/** Фигура, нарисованная в редакторе: свой вид и своя заливка, а не догадка по площади. */
function shapeElement(
  shape: ShapeName,
  id: string,
  box: Box,
  look: {
    readonly tail?: 'none' | 'arrow';
    readonly flipH?: boolean;
    readonly flipV?: boolean;
  } = {},
): SlideElement {
  const line = shape === 'line';
  return {
    kind: 'decor',
    elementId: id,
    role: 'decoration',
    box,
    // Нарисовано в редакторе, а не взято из шаблона.
    sourceShapeId: null,
    shape,
    fill: line ? null : 'accent',
    stroke: line ? stroke(look.tail ?? 'none') : null,
    ...(look.flipH ? { flipH: true } : null),
    ...(look.flipV ? { flipV: true } : null),
  };
}

function one(tool: InsertTool, box: Box, id: string, options: InsertOptions): SlideElement {
  switch (tool) {
    case 'text':
      return {
        kind: 'text',
        elementId: id,
        role: 'body',
        box,
        sourceShapeId: null,
        paragraphs: [{ level: 0, runs: [run()] }],
        overflow: null,
      };
    case 'image':
      return {
        kind: 'image',
        elementId: id,
        role: 'image',
        box,
        sourceShapeId: null,
        // Адреса ещё нет: пока файл не выбран, на слайде рамка.
        mediaPart: `upload/${id}`,
        fit: 'contain',
      };
    case 'chart':
      return {
        kind: 'chart',
        elementId: id,
        role: 'chart',
        box,
        sourceShapeId: null,
        chartType: 'column',
        categories: ['1', '2', '3'],
        series: [{ name: '1', values: [4, 7, 5] }],
        xTitle: '',
        yTitle: '',
      };
    case 'table':
      return {
        kind: 'table',
        elementId: id,
        role: 'table',
        box,
        sourceShapeId: null,
        headers: ['', ''],
        rows: [
          ['', ''],
          ['', ''],
        ],
      };
    default: {
      const shape = SHAPE_OF[tool] ?? 'rect';
      return shapeElement(shape, id, box, {
        tail: tool === 'arrow' ? 'arrow' : 'none',
        flipH: options.reversedX === true,
        flipV: options.reversedY === true,
      });
    }
  }
}

function diagram(box: Box, grid: Grid, next: () => string): SlideElement[] {
  const gap = Math.max(grid.gutter, Math.round(box.cx * 0.06));
  const count = 3;
  const nodeW = Math.max(1, Math.round((box.cx - gap * (count - 1)) / count));
  const nodeH = Math.max(grid.baseline, Math.round(box.cy * 0.62));
  const y = box.y + Math.round((box.cy - nodeH) / 2);
  const nodes: SlideElement[] = [];
  for (let index = 0; index < count; index += 1) {
    nodes.push(
      shapeElement('round-rect', next(), {
        x: box.x + index * (nodeW + gap),
        y,
        cx: nodeW,
        cy: nodeH,
      }),
    );
  }
  const arrows: SlideElement[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    const left = nodes[index]?.box;
    const right = nodes[index + 1]?.box;
    if (!left || !right) continue;
    arrows.push(
      shapeElement(
        'line',
        next(),
        {
          x: left.x + left.cx,
          y: y + Math.round(nodeH / 2),
          cx: Math.max(1, right.x - (left.x + left.cx)),
          cy: 0,
        },
        { tail: 'arrow' },
      ),
    );
  }
  // Стрелки поверх карточек: наконечник должен быть виден на фоне соседнего узла.
  return [...nodes, ...arrows];
}

/**
 * Рамка в пропорциях картинки, вписанная в то, что попросил жест, и по его центру. Без размера
 * картинки (SVG без габаритов) рамка остаётся как есть: `contain` всё равно не исказит файл.
 */
export function fitAspect(target: Box, natural: { width: number; height: number } | null): Box {
  if (!natural || natural.width <= 0 || natural.height <= 0 || target.cx <= 0 || target.cy <= 0) {
    return { ...target };
  }
  const ratio = natural.width / natural.height;
  const cx = Math.max(1, Math.round(Math.min(target.cx, target.cy * ratio)));
  const cy = Math.max(1, Math.round(cx / ratio));
  return {
    x: Math.round(target.x + (target.cx - cx) / 2),
    y: Math.round(target.y + (target.cy - cy) / 2),
    cx,
    cy,
  };
}

/**
 * Картинка с диска. Клик берёт размер картинки по умолчанию, протяжка — свою рамку; в обоих
 * случаях рамка подстраивается под пропорции файла, чтобы картинка не ложилась с полями.
 */
export function createImageElement(
  mediaPart: string,
  drag: Box,
  grid: Grid,
  natural: { width: number; height: number } | null,
  options: InsertOptions = {},
): SlideElement {
  const next = options.nextId ?? (() => crypto.randomUUID());
  const box = fitAspect(placedBox('image', drag, grid, options.profile), natural);
  return {
    kind: 'image',
    elementId: next(),
    role: 'image',
    box,
    sourceShapeId: null,
    mediaPart,
    fit: 'contain',
  };
}

/**
 * Элементы одной вставки. Несколько фигур схемы приходят одним вызовом, чтобы одна отмена
 * убирала всю схему целиком.
 */
export function createInsertedElements(
  tool: InsertTool,
  drag: Box,
  grid: Grid,
  options: InsertOptions | (() => string) = {},
): SlideElement[] {
  const settings = optionsOf(options);
  const next = settings.nextId ?? (() => crypto.randomUUID());
  const box = placedBox(tool, drag, grid, settings.profile);
  if (tool === 'diagram') return diagram(box, grid, next);
  return [one(tool, box, next(), settings)];
}
