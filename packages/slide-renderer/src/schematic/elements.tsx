import type { CSSProperties, JSX, ReactNode } from 'react';
import type { Box, ElementRole, SlideElement } from '@lct/contracts';
import { boxStyle, cqw, emuToCqw, percent, round, type SlideSize } from '../geometry.js';
import { SERIES_LEVELS, hairline, ink, type InkLevel } from './ink.js';
import { layoutText, textWidthEmu, type TextElement, type TypeResolver } from './text-layout.js';

type ElementOf<K extends SlideElement['kind']> = Extract<SlideElement, { kind: K }>;

interface Context {
  readonly size: SlideSize;
  readonly type: TypeResolver;
}

/*
 * Every mark is placed in percentages of its element box and sized in `cqw`, so the whole slide
 * scales with the frame. Thicknesses go through `hairline` to survive a thumbnail.
 */

function at(box: Box, x: number, y: number): CSSProperties {
  return {
    position: 'absolute',
    left: percent((x / box.cx) * 100),
    top: percent((y / box.cy) * 100),
  };
}

/**
 * How a bar ends. `round` is a line of copy: with square ends a large heading reads as a
 * redaction mark rather than as words. `soft` is a label inside a table or a chart, which sits
 * among square cells and bars and only loses its corners.
 */
type BarEnds = 'round' | 'soft';

function bar(
  box: Box,
  context: Context,
  x: number,
  y: number,
  width: number,
  thickness: number,
  level: InkLevel,
  ends: BarEnds = 'soft',
): CSSProperties {
  const height = hairline(cqw(emuToCqw(thickness, context.size)));
  return {
    ...at(box, x, y),
    width: percent((width / box.cx) * 100),
    height,
    borderRadius:
      ends === 'round'
        ? `calc(${height} / 2)`
        : // The radius stops growing at a fraction of the slide however thick the line gets.
          cqw(Math.min(emuToCqw(thickness * 0.15, context.size), 0.2)),
    background: ink(level),
  };
}

function Element({
  element,
  context,
  style,
  children,
}: {
  element: SlideElement;
  context: Context;
  style?: CSSProperties;
  children?: ReactNode;
}): JSX.Element {
  return (
    <div
      data-kind={element.kind}
      data-role={element.role}
      data-element-id={element.elementId}
      style={{ ...boxStyle(element.box, context.size), ...style }}
    >
      {children}
    </div>
  );
}

/* Text */

const TEXT_LEVEL: Partial<Record<ElementRole, InkLevel>> = {
  title: 'strong',
  'kpi-value': 'strong',
  subtitle: 'emphasis',
  quote: 'emphasis',
  footer: 'muted',
};

function TextSchematic({
  element,
  context,
}: {
  element: TextElement;
  context: Context;
}): JSX.Element {
  if (element.role === 'page-number') return <PageNumber element={element} context={context} />;
  const { box } = element;
  const layout = layoutText(element, context.type);
  const base = TEXT_LEVEL[element.role] ?? 'text';
  // A bold paragraph inside running text is a heading of it: one step up, not more.
  const levelOf = (bold: boolean): InkLevel => (bold && base === 'text' ? 'emphasis' : base);
  return (
    <Element element={element} context={context}>
      {layout.markers.map((marker) => {
        const side = hairline(cqw(emuToCqw(marker.size, context.size)));
        return (
          <div
            key={`m${marker.paragraph}`}
            style={{
              ...at(box, marker.x, marker.y),
              width: side,
              height: side,
              borderRadius: '50%',
              background: ink(levelOf(false)),
            }}
          />
        );
      })}
      {layout.bars.map((line, index) => (
        <div
          key={index}
          style={{
            ...bar(
              box,
              context,
              line.x,
              line.y,
              line.width,
              line.thickness,
              levelOf(line.bold),
              'round',
            ),
            ...(line.italic ? { transform: 'skewX(-12deg)' } : null),
          }}
        />
      ))}
    </Element>
  );
}

/**
 * A page number is a digit or two in footer type: drawn as a line it is a speck. It becomes a
 * capsule as wide as its digits instead, which finds it on a thumbnail without inventing a size.
 */
function PageNumber({ element, context }: { element: TextElement; context: Context }): JSX.Element {
  const { box } = element;
  const [line] = layoutText(element, context.type).bars;
  if (!line) return <Element element={element} context={context} />;
  const height = Math.min(line.size * 1.2, box.cy);
  const width = Math.min(Math.max(line.width + line.size * 0.8, line.size * 1.5), box.cx - line.x);
  const top = Math.min(Math.max(line.y + (line.thickness - height) / 2, 0), box.cy - height);
  return (
    <Element element={element} context={context}>
      <div
        style={{
          ...at(box, line.x, top),
          width: percent((width / box.cx) * 100),
          height: percent((height / box.cy) * 100),
          borderRadius: cqw(emuToCqw(height / 2, context.size)),
          background: ink('muted'),
        }}
      />
    </Element>
  );
}

/* Images */

/** A landscape and a sun, filled rather than stroked so the mark scales without a line width. */
function PictureGlyph({ side }: { side: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: side,
        height: side,
        transform: 'translate(-50%, -50%)',
        fill: ink('muted'),
      }}
    >
      <circle cx="8" cy="7.5" r="2.5" />
      <path d="M1.5 20.5 8.5 12l4.25 5 3.25-3.5 6.5 7z" />
    </svg>
  );
}

function ImageSchematic({
  element,
  context,
}: {
  element: ElementOf<'image'>;
  context: Context;
}): JSX.Element {
  const { box } = element;
  if (element.role === 'logo') {
    // A logo is a solid mark of the template, not a picture slot: no frame, no glyph.
    return <Element element={element} context={context} style={{ background: ink('mark') }} />;
  }
  const side = Math.min(Math.min(box.cx, box.cy) * 0.22, context.size.cx * 0.05);
  return (
    <Element
      element={element}
      context={context}
      style={{
        background: ink('fill'),
        boxShadow: `inset 0 0 0 ${hairline(cqw(0.08))} ${ink('line')}`,
      }}
    >
      <PictureGlyph side={cqw(emuToCqw(side, context.size))} />
    </Element>
  );
}

/* Tables */

function TableSchematic({
  element,
  context,
}: {
  element: ElementOf<'table'>;
  context: Context;
}): JSX.Element {
  const { box, headers, rows } = element;
  const all = [headers, ...rows];
  const columns = Math.max(...all.map((row) => row.length));
  const rowH = box.cy / all.length;
  const colW = box.cx / columns;
  // Column widths and cell type are not in the IR: equal columns, text sized from the row.
  const size = Math.min(context.type.sizeEmu('table'), rowH * 0.42);
  const pad = Math.min(rowH * 0.4, colW * 0.08);
  const rule = hairline(cqw(0.08));
  return (
    <Element element={element} context={context}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: percent(100 / all.length),
          background: ink('fill'),
        }}
      />
      {all.map((_, r) => (
        <div
          key={`r${r}`}
          style={{
            position: 'absolute',
            left: 0,
            top: percent(((r + 1) * 100) / all.length),
            width: '100%',
            height: rule,
            transform: 'translateY(-50%)',
            background: ink('line'),
          }}
        />
      ))}
      {all.flatMap((row, r) =>
        row.map((cell, c) => {
          const header = r === 0;
          const thickness = size * (header ? 0.6 : 0.5);
          const width = Math.min(textWidthEmu(cell, size, header), colW - pad * 2);
          if (cell.trim() === '' || width <= 0) return null;
          return (
            <div
              key={`c${r}-${c}`}
              style={bar(
                box,
                context,
                c * colW + pad,
                r * rowH + (rowH - thickness) / 2,
                width,
                thickness,
                header ? 'text' : 'muted',
              )}
            />
          );
        }),
      )}
    </Element>
  );
}

/* Charts */

function seriesLevel(index: number): InkLevel {
  return SERIES_LEVELS[index % SERIES_LEVELS.length] ?? 'text';
}

function ChartSchematic({
  element,
  context,
}: {
  element: ElementOf<'chart'>;
  context: Context;
}): JSX.Element {
  const { box, categories, series, chartType } = element;
  const label = Math.min(context.type.sizeEmu('chart'), box.cy * 0.06);
  const labelBar = label * 0.5;
  const value = (s: number, c: number) => Math.max(series[s]?.values[c] ?? 0, 0);
  const peak = Math.max(...series.flatMap((entry) => entry.values), 0) || 1;
  const axis = hairline(cqw(0.08));

  if (chartType === 'pie') return <PieSchematic element={element} context={context} />;

  if (chartType === 'bar') {
    // Categories down the side, values across. Labels sit right-aligned against the axis.
    const widest = Math.max(...categories.map((name) => textWidthEmu(name, label)));
    const gutter = Math.min(widest + label, box.cx * 0.34);
    const rowH = box.cy / categories.length;
    const band = (rowH * 0.5) / series.length;
    const span = (box.cx - gutter) * 0.96;
    return (
      <Element element={element} context={context}>
        <div
          style={{
            ...at(box, gutter, 0),
            width: axis,
            height: '100%',
            background: ink('line'),
          }}
        />
        {categories.map((name, c) => {
          const top = c * rowH + (rowH - band * series.length) / 2;
          const width = Math.min(textWidthEmu(name, label), gutter - label);
          return [
            <div
              key={`l${c}`}
              style={bar(
                box,
                context,
                gutter - label * 0.6 - width,
                c * rowH + (rowH - labelBar) / 2,
                width,
                labelBar,
                'muted',
              )}
            />,
            ...series.map((_, s) => (
              <div
                key={`b${c}-${s}`}
                style={{
                  ...at(box, gutter, top + s * band),
                  width: percent(((value(s, c) / peak) * span * 100) / box.cx),
                  height: percent((band * 100) / box.cy),
                  background: ink(seriesLevel(s)),
                }}
              />
            )),
          ];
        })}
      </Element>
    );
  }

  // Column, line and area: categories along the bottom, values up.
  const bottom = box.cy - label * 2;
  const top = label * 0.5;
  const plot = bottom - top;
  const groupW = box.cx / categories.length;
  const labels = categories.map((name, c) => {
    const width = Math.min(textWidthEmu(name, label), groupW * 0.84);
    return (
      <div
        key={`l${c}`}
        style={bar(
          box,
          context,
          c * groupW + (groupW - width) / 2,
          bottom + label * 0.75,
          width,
          labelBar,
          'muted',
        )}
      />
    );
  });
  const baseline = (
    <div
      style={{
        ...at(box, 0, bottom),
        width: '100%',
        height: axis,
        transform: 'translateY(-50%)',
        background: ink('line'),
      }}
    />
  );

  if (chartType === 'column') {
    const bandW = (groupW * 0.6) / series.length;
    return (
      <Element element={element} context={context}>
        {categories.flatMap((_, c) =>
          series.map((__, s) => {
            const height = (value(s, c) / peak) * plot;
            return (
              <div
                key={`b${c}-${s}`}
                style={{
                  ...at(
                    box,
                    c * groupW + (groupW - bandW * series.length) / 2 + s * bandW,
                    bottom - height,
                  ),
                  width: percent((bandW * 100) / box.cx),
                  height: percent((height * 100) / box.cy),
                  background: ink(seriesLevel(s)),
                }}
              />
            );
          }),
        )}
        {baseline}
        {labels}
      </Element>
    );
  }

  // Line and area share a viewBox in units of the box, a thousand across.
  const scale = 1000 / box.cx;
  const point = (s: number, c: number) =>
    `${round((c + 0.5) * groupW * scale)},${round((bottom - (value(s, c) / peak) * plot) * scale)}`;
  // The stroke sits in screen space (`non-scaling-stroke`), so `cqw` and the pixel floor apply as
  // written. It grows with the chart but stays a line on a small one.
  const stroke = hairline(
    cqw(
      Math.max(
        emuToCqw(box.cx * 0.004, context.size),
        emuToCqw(context.size.cx * 0.0015, context.size),
      ),
    ),
  );
  return (
    <Element element={element} context={context}>
      <svg
        viewBox={`0 0 1000 ${round(box.cy * scale)}`}
        preserveAspectRatio="none"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          overflow: 'visible',
        }}
      >
        {series.map((_, s) => {
          const points = categories.map((__, c) => point(s, c));
          const first = `${round(0.5 * groupW * scale)},${round(bottom * scale)}`;
          const last = `${round((categories.length - 0.5) * groupW * scale)},${round(bottom * scale)}`;
          return (
            <g key={`s${s}`}>
              {chartType === 'area' ? (
                <polygon
                  points={[first, ...points, last].join(' ')}
                  style={{ fill: ink(seriesLevel(s)), fillOpacity: 0.5 }}
                />
              ) : null}
              <polyline
                points={points.join(' ')}
                style={{
                  fill: 'none',
                  stroke: ink(seriesLevel(s)),
                  strokeWidth: stroke,
                  strokeLinejoin: 'round',
                  strokeLinecap: 'round',
                  vectorEffect: 'non-scaling-stroke',
                }}
              />
            </g>
          );
        })}
      </svg>
      {baseline}
      {labels}
    </Element>
  );
}

function PieSchematic({
  element,
  context,
}: {
  element: ElementOf<'chart'>;
  context: Context;
}): JSX.Element {
  const { box } = element;
  // A pie shows one series, the first, as PowerPoint does.
  const values = (element.series[0]?.values ?? []).map((v) => Math.max(v, 0));
  const total = values.reduce((sum, v) => sum + v, 0);
  const scale = 1000 / box.cx;
  const height = box.cy * scale;
  const radius = Math.min(1000, height) * 0.46;
  const cx = 500;
  const cy = height / 2;
  const pointAt = (turn: number) => {
    // Clockwise from twelve o'clock, where PowerPoint starts the first slice.
    const angle = turn * 2 * Math.PI - Math.PI / 2;
    return `${round(cx + radius * Math.cos(angle))} ${round(cy + radius * Math.sin(angle))}`;
  };
  let start = 0;
  const sectors = values.map((v, i) => {
    const share = total > 0 ? v / total : 0;
    const from = start;
    start += share;
    if (share <= 0) return null;
    const style = { fill: ink(seriesLevel(i)) };
    if (share >= 1) {
      return <circle key={i} cx={round(cx)} cy={round(cy)} r={round(radius)} style={style} />;
    }
    const d = `M${round(cx)} ${round(cy)}L${pointAt(from)}A${round(radius)} ${round(radius)} 0 ${
      share > 0.5 ? 1 : 0
    } 1 ${pointAt(start)}Z`;
    return <path key={i} d={d} style={style} />;
  });
  return (
    <Element element={element} context={context}>
      <svg
        viewBox={`0 0 1000 ${round(height)}`}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      >
        {total > 0 ? (
          sectors
        ) : (
          <circle cx={round(cx)} cy={round(cy)} r={round(radius)} style={{ fill: ink('fill') }} />
        )}
      </svg>
    </Element>
  );
}

/* Template shapes */

/**
 * Density follows size, because the eye does: a rule under a title is a few points tall and
 * disappears at the density of a panel, while a panel at the density of a rule drowns the slide.
 */
function decorLevel(box: Box, size: SlideSize): InkLevel {
  const thinnest = Math.min(box.cx, box.cy) / size.cx;
  if (thinnest <= 0.012) return 'rule';
  if ((box.cx * box.cy) / (size.cx * size.cy) <= 0.01) return 'mark';
  return 'decor';
}

function DecorSchematic({
  element,
  context,
}: {
  element: ElementOf<'decor'>;
  context: Context;
}): JSX.Element {
  const { box } = element;
  // A line shape has no height (or no width) in OOXML; it still has to show.
  const line = hairline(cqw(0.08));
  return (
    <Element
      element={element}
      context={context}
      style={{
        background: ink(decorLevel(box, context.size)),
        ...(box.cy === 0 ? { height: line } : null),
        ...(box.cx === 0 ? { width: line } : null),
      }}
    />
  );
}

export function SchematicElement({
  element,
  size,
  type,
}: {
  element: SlideElement;
  size: SlideSize;
  type: TypeResolver;
}): JSX.Element | null {
  const context: Context = { size, type };
  const { cx, cy } = element.box;
  if (element.kind === 'decor') {
    return cx >= 0 && cy >= 0 && cx + cy > 0 ? (
      <DecorSchematic element={element} context={context} />
    ) : null;
  }
  // Everything else lays its marks out inside the box, which needs an area to divide.
  if (cx <= 0 || cy <= 0) return null;
  switch (element.kind) {
    case 'text':
      return <TextSchematic element={element} context={context} />;
    case 'image':
      return <ImageSchematic element={element} context={context} />;
    case 'table':
      return <TableSchematic element={element} context={context} />;
    case 'chart':
      return <ChartSchematic element={element} context={context} />;
  }
}
