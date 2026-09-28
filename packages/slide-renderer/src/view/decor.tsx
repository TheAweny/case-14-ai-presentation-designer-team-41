import type { CSSProperties, JSX, SVGProps } from 'react';
import type {
  Box,
  DecorGeometry,
  DesignSystem,
  SlideElement,
  ElementStroke,
  StrokeDash,
} from '@lct/contracts';
import { EMU_PER_PT, cqw, emuToCqw, round, type SlideSize } from '../geometry.js';
import { paint, resolveColor } from './color.js';
import { markHooks, markStyle } from './mark.js';
import { ShapeText } from './shape-text.js';

type DecorElement = Extract<SlideElement, { kind: 'decor' }>;

/** A rule with no thickness in OOXML still has to show: this is the least it gets. */
function hairlineEmu(size: SlideSize): number {
  return Math.max(size.cx * 0.0012, 1);
}

/**
 * Template decoration that states nothing but a box is painted with a palette role chosen from
 * its share of the slide: a full-bleed panel and a small mark read as accent, a card as surface,
 * a rule as a line. Anything that states a fill never comes here, so a shape the editor drew keeps
 * its colour whatever its size.
 */
function guessedPaint(box: Box, size: SlideSize, profile: DesignSystem): string {
  const area = box.cx > 0 && box.cy > 0 ? (box.cx * box.cy) / (size.cx * size.cy) : 0;
  const thin = Math.min(box.cx, box.cy) / size.cx;
  if (box.cx === 0 || box.cy === 0 || thin <= 0.012)
    return paint(profile.palette, 'accent', 'line');
  if (area >= 0.5 || area <= 0.01) return paint(profile.palette, 'accent', 'text');
  return paint(profile.palette, 'surface', 'background');
}

/** Whether the element says how it looks, rather than leaving it to the geometry. */
function statesItsLook(element: DecorElement): boolean {
  return (
    element.shape !== undefined ||
    element.geometry !== undefined ||
    element.fill !== undefined ||
    element.stroke !== undefined
  );
}

/**
 * What a shape is filled with, as CSS, or null when the slide shows through it: no fill, or a
 * line. Words in the shape take their colour from it, on the slide and in the editor alike.
 */
export function decorFill(
  element: DecorElement,
  size: SlideSize,
  profile: DesignSystem,
): string | null {
  if (element.shape === 'line') return null;
  if (!statesItsLook(element) || element.fill === undefined) {
    return guessedPaint(element.box, size, profile);
  }
  return element.fill === null ? null : resolveColor(profile.palette, element.fill, 'surface');
}

/** Dash patterns in multiples of the line width, as PowerPoint's preset dashes are defined. */
const DASH: Record<StrokeDash, readonly number[] | null> = {
  solid: null,
  dash: [4, 3],
  dot: [1, 1],
};

/** Default corner of a round-rect, as a share of the shorter side: PowerPoint's own default. */
const DEFAULT_CORNER = 1 / 6;

/** An arrowhead is three line widths long and wide, PowerPoint's medium triangle. */
const HEAD_PER_WIDTH = 3;
/** The least head a hairline gets, in points, so an arrow still reads as one. */
const MIN_HEAD_PT = 3;
/** The least band around a line that takes the pointer, in points. */
const MIN_HIT_PT = 8;

interface Frame {
  /** Width and height of the drawing in points, never zero. */
  readonly w: number;
  readonly h: number;
}

function strokeProps(stroke: ElementStroke, color: string): SVGProps<SVGElement> {
  const width = stroke.widthEmu / EMU_PER_PT;
  const dash = DASH[stroke.dash];
  return {
    stroke: color,
    strokeWidth: round(width),
    ...(dash ? { strokeDasharray: dash.map((step) => round(step * width)).join(' ') } : null),
    strokeLinejoin: 'miter',
    strokeLinecap: 'butt',
  };
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Ends of a line in its box. It runs from the top left to the bottom right unless flipped, as a
 * connector does in OOXML; a box with no height or no width is a straight rule through its middle.
 */
function lineEnds(element: DecorElement, frame: Frame): { from: Point; to: Point } {
  const { box } = element;
  const flipX = (x: number) => (element.flipH ? frame.w - x : x);
  const flipY = (y: number) => (element.flipV ? frame.h - y : y);
  const y0 = box.cy === 0 ? frame.h / 2 : 0;
  const y1 = box.cy === 0 ? frame.h / 2 : frame.h;
  const x0 = box.cx === 0 ? frame.w / 2 : 0;
  const x1 = box.cx === 0 ? frame.w / 2 : frame.w;
  return {
    from: { x: flipX(x0), y: flipY(y0) },
    to: { x: flipX(x1), y: flipY(y1) },
  };
}

/** A filled triangle whose tip is `tip`, pointing away from `from`; and where the shaft ends. */
function arrowHead(from: Point, tip: Point, widthPt: number): { points: string; base: Point } {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { points: '', base: tip };
  const ux = dx / length;
  const uy = dy / length;
  const head = Math.min(Math.max(widthPt * HEAD_PER_WIDTH, MIN_HEAD_PT), length * 0.5);
  const half = head / 2;
  const base = { x: tip.x - ux * head, y: tip.y - uy * head };
  const left = { x: base.x - uy * half, y: base.y + ux * half };
  const right = { x: base.x + uy * half, y: base.y - ux * half };
  const points = [tip, left, right].map((point) => `${round(point.x)},${round(point.y)}`);
  return { points: points.join(' '), base };
}

function LineShape({
  element,
  frame,
  stroke,
  color,
  interactive,
}: {
  element: DecorElement;
  frame: Frame;
  stroke: ElementStroke;
  color: string;
  interactive: boolean;
}): JSX.Element {
  const { from, to } = lineEnds(element, frame);
  const width = stroke.widthEmu / EMU_PER_PT;
  const tail = stroke.tail === 'arrow' ? arrowHead(from, to, width) : null;
  const head = stroke.head === 'arrow' ? arrowHead(to, from, width) : null;
  // The shaft stops at the base of a head, so its square end never shows past the point.
  const start = head?.base ?? from;
  const end = tail?.base ?? to;
  return (
    <>
      {interactive ? (
        <line
          x1={round(from.x)}
          y1={round(from.y)}
          x2={round(to.x)}
          y2={round(to.y)}
          stroke="transparent"
          strokeWidth={round(Math.max(width * HEAD_PER_WIDTH, MIN_HIT_PT))}
          pointerEvents="stroke"
        />
      ) : null}
      <line
        x1={round(start.x)}
        y1={round(start.y)}
        x2={round(end.x)}
        y2={round(end.y)}
        {...(strokeProps(stroke, color) as SVGProps<SVGLineElement>)}
      />
      {tail?.points ? <polygon points={tail.points} fill={color} /> : null}
      {head?.points ? <polygon points={head.points} fill={color} /> : null}
    </>
  );
}

function ClosedShape({
  element,
  frame,
  fill,
  stroke,
  strokeColor,
}: {
  element: DecorElement;
  frame: Frame;
  fill: string;
  stroke: ElementStroke | null;
  strokeColor: string;
}): JSX.Element {
  const { w, h } = frame;
  const paintProps = {
    fill,
    ...(stroke ? strokeProps(stroke, strokeColor) : null),
  } as SVGProps<SVGElement>;
  const flip = [
    element.flipH ? `translate(${round(w)} 0) scale(-1 1)` : '',
    element.flipV ? `translate(0 ${round(h)}) scale(1 -1)` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const shape = element.shape ?? 'rect';
  let body: JSX.Element;
  switch (shape) {
    case 'ellipse':
      body = (
        <ellipse
          cx={round(w / 2)}
          cy={round(h / 2)}
          rx={round(w / 2)}
          ry={round(h / 2)}
          {...(paintProps as SVGProps<SVGEllipseElement>)}
        />
      );
      break;
    case 'triangle':
      body = (
        <polygon
          points={`${round(w / 2)},0 ${round(w)},${round(h)} 0,${round(h)}`}
          {...(paintProps as SVGProps<SVGPolygonElement>)}
        />
      );
      break;
    case 'diamond':
      body = (
        <polygon
          points={`${round(w / 2)},0 ${round(w)},${round(h / 2)} ${round(w / 2)},${round(h)} 0,${round(h / 2)}`}
          {...(paintProps as SVGProps<SVGPolygonElement>)}
        />
      );
      break;
    default: {
      const radius =
        shape === 'round-rect' ? (element.cornerRadius ?? DEFAULT_CORNER) * Math.min(w, h) : 0;
      body = (
        <rect
          x={0}
          y={0}
          width={round(w)}
          height={round(h)}
          {...(radius > 0 ? { rx: round(radius), ry: round(radius) } : null)}
          {...(paintProps as SVGProps<SVGRectElement>)}
        />
      );
    }
  }
  return flip ? <g transform={flip}>{body}</g> : body;
}

/**
 * An outline no named shape describes, as the file draws it: its paths in their own space,
 * stretched over the box the way PowerPoint stretches a freeform. The stretch must not reach the
 * line, so the stroke does not scale with the drawing (`non-scaling-stroke`) and its width is
 * stated in `cqw`: the same share of the slide as `widthEmu` at any size and in any box.
 */
function GeometryShape({
  element,
  geometry,
  size,
  fill,
  stroke,
  strokeColor,
}: {
  element: DecorElement;
  geometry: DecorGeometry;
  size: SlideSize;
  fill: string | null;
  stroke: ElementStroke | null;
  strokeColor: string;
}): JSX.Element {
  const { width: w, height: h } = geometry;
  const dash = stroke ? DASH[stroke.dash] : null;
  const line: CSSProperties | null = stroke
    ? {
        stroke: strokeColor,
        strokeWidth: cqw(emuToCqw(stroke.widthEmu, size)),
        vectorEffect: 'non-scaling-stroke',
        strokeLinejoin: 'miter',
        strokeLinecap: 'butt',
        ...(dash
          ? {
              strokeDasharray: dash
                .map((step) => cqw(emuToCqw(step * stroke.widthEmu, size)))
                .join(' '),
            }
          : null),
      }
    : null;
  const flip = [
    element.flipH ? `translate(${round(w)} 0) scale(-1 1)` : '',
    element.flipV ? `translate(0 ${round(h)}) scale(1 -1)` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${round(w)} ${round(h)}`}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      style={{ position: 'absolute', inset: 0, display: 'block', overflow: 'visible' }}
    >
      <g transform={flip || undefined}>
        {geometry.paths.map((path, index) => (
          <path
            key={index}
            d={path.d}
            fill={path.filled && fill ? fill : 'none'}
            style={path.stroked && line ? line : undefined}
          />
        ))}
      </g>
    </svg>
  );
}

/**
 * Decoration: a panel, a rule, a card, or a shape drawn in the editor.
 *
 * The box is the drag target. When the element states its look, an SVG inside the box draws the
 * geometry in points, so the drawing scales with the slide and a line width in EMU stays a share of
 * the slide at any size. When it states nothing, the box itself is painted by `guessedPaint`.
 */
export function DecorMark({
  element,
  size,
  profile,
  thumbnail = false,
}: {
  element: DecorElement;
  size: SlideSize;
  profile: DesignSystem;
  thumbnail?: boolean;
}): JSX.Element | null {
  const { box } = element;
  if (box.cx < 0 || box.cy < 0 || box.cx + box.cy === 0) return null;
  const least = hairlineEmu(size);
  // A zero axis gets the least thickness, both on the page and in the drawing, so the two agree.
  const zeroAxis = {
    ...(box.cy === 0 ? { height: cqw(emuToCqw(least, size)) } : null),
    ...(box.cx === 0 ? { width: cqw(emuToCqw(least, size)) } : null),
  };
  const hooks = markHooks(element, thumbnail);

  if (!statesItsLook(element)) {
    const background = guessedPaint(box, size, profile);
    return (
      <div
        {...hooks}
        style={{
          ...markStyle(element, size),
          background,
          ...zeroAxis,
        }}
      >
        <ShapeText element={element} size={size} profile={profile} fill={background} />
      </div>
    );
  }

  if (element.geometry) {
    const fill = decorFill(element, size, profile);
    const stroke = element.stroke ?? null;
    return (
      <div
        {...hooks}
        {...(thumbnail ? null : { 'data-shape': 'custom' })}
        style={{ ...markStyle(element, size), ...zeroAxis }}
      >
        <GeometryShape
          element={element}
          geometry={element.geometry}
          size={size}
          fill={fill}
          stroke={stroke}
          strokeColor={stroke ? resolveColor(profile.palette, stroke.color, 'line') : 'none'}
        />
        <ShapeText element={element} size={size} profile={profile} fill={fill} />
      </div>
    );
  }

  const shape = element.shape ?? 'rect';
  const frame: Frame = {
    w: Math.max(box.cx, least) / EMU_PER_PT,
    h: Math.max(box.cy, least) / EMU_PER_PT,
  };
  const guessed = guessedPaint(box, size, profile);
  let drawing: JSX.Element;
  if (shape === 'line') {
    // A line that states no stroke is a template rule: the least width in the guessed colour.
    const stroke: ElementStroke = element.stroke ?? {
      color: 'accent',
      widthEmu: Math.max(1, Math.round(least)),
      dash: 'solid',
      head: 'none',
      tail: 'none',
    };
    const color = element.stroke
      ? resolveColor(profile.palette, element.stroke.color, 'line')
      : guessed;
    drawing = (
      <LineShape
        element={element}
        frame={frame}
        stroke={stroke}
        color={color}
        interactive={!thumbnail}
      />
    );
  } else {
    const fill = decorFill(element, size, profile) ?? 'none';
    const stroke = element.stroke ?? null;
    drawing = (
      <ClosedShape
        element={element}
        frame={frame}
        fill={fill}
        stroke={stroke}
        strokeColor={stroke ? resolveColor(profile.palette, stroke.color, 'line') : 'none'}
      />
    );
  }

  return (
    <div
      {...hooks}
      {...(thumbnail ? null : { 'data-shape': shape })}
      style={{ ...markStyle(element, size), ...zeroAxis }}
    >
      <svg
        aria-hidden
        viewBox={`0 0 ${round(frame.w)} ${round(frame.h)}`}
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0, display: 'block', overflow: 'visible' }}
      >
        {drawing}
      </svg>
      <ShapeText
        element={element}
        size={size}
        profile={profile}
        fill={decorFill(element, size, profile)}
      />
    </div>
  );
}
