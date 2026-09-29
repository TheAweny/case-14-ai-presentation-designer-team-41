import type { JSX } from 'react';
import { curveMonotoneX } from '@visx/curve';
import { Group } from '@visx/group';
import { scaleBand, scaleLinear } from '@visx/scale';
import { AreaClosed, Bar, Circle, Line, LinePath, Pie } from '@visx/shape';
import type { Box, DesignSystem, SlideElement } from '@lct/contracts';
import { EMU_PER_PT, type SlideSize } from '../geometry.js';
import { createTypeResolver, textWidthEmu, typeRoleOf } from '../schematic/text-layout.js';
import { wrapLabel } from './chart-labels.js';
import { fontFamily, paint, seriesPaint } from './color.js';
import { markHooks, markStyle } from './mark.js';

type ChartElement = Extract<SlideElement, { kind: 'chart' }>;

interface Metrics {
  readonly size: number;
  readonly font: string | undefined;
  readonly fill: string;
  readonly axis: string;
  readonly stroke: number;
}

interface Plot {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

function metricsOf(profile: DesignSystem, box: Box, slideCy: number): Metrics {
  const type = createTypeResolver(profile, slideCy);
  const style = profile.typeScale.find((entry) => entry.role === typeRoleOf('chart'));
  // Points, not EMU: a viewBox in the millions drops SVG text in the browser.
  const preferred = type.sizeEmu('chart') / EMU_PER_PT;
  const size = Math.max(Math.min(preferred, box.cy * 0.09, box.cx * 0.045), 1);
  return {
    size,
    font: fontFamily(style?.font ?? ''),
    fill: paint(profile.palette, style?.colorRole ?? 'text-muted', 'text'),
    axis: paint(profile.palette, 'line', 'text'),
    stroke: Math.max(size * 0.08, 0.6),
  };
}

function extent(element: ChartElement): { min: number; max: number } {
  const values = element.series.flatMap((entry) => entry.values);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  if (min === max) return { min: 0, max: min === 0 ? 1 : Math.abs(min) || 1 };
  return { min, max };
}

const numbers = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

/** A value as it is printed on its mark: a chart on a slide is read, not measured. */
function valueText(value: number): string {
  return numbers.format(value);
}

function ids(element: ChartElement): string[] {
  return element.categories.map((_, index) => String(index));
}

function valueAt(element: ChartElement, series: number, category: number): number {
  return element.series[series]?.values[category] ?? 0;
}

function Label({
  x,
  y,
  text,
  lines,
  metrics,
  anchor = 'start',
  baseline = 'auto',
}: {
  x: number;
  y: number;
  text: string;
  /** Text already broken to fit its slot; one line per entry. */
  lines?: readonly string[];
  metrics: Metrics;
  anchor?: 'start' | 'middle' | 'end';
  baseline?: 'auto' | 'middle' | 'hanging';
}): JSX.Element {
  return (
    <text
      x={x}
      y={y}
      fill={metrics.fill}
      fontFamily={metrics.font}
      fontSize={metrics.size}
      textAnchor={anchor}
      dominantBaseline={baseline}
    >
      {lines && lines.length > 1
        ? lines.map((line, index) => (
            <tspan key={index} x={x} dy={index === 0 ? 0 : `${LABEL_LINE}em`}>
              {line}
            </tspan>
          ))
        : (lines?.[0] ?? text)}
      {lines && lines.join(' ') !== text ? <title>{text}</title> : null}
    </text>
  );
}

/** Line pitch of wrapped category labels, in em. */
const LABEL_LINE = 1.15;

/** How many lines the widest category label needs under a column or trend chart. */
function labelLinesOf(element: ChartElement, plot: Plot, metrics: Metrics): number {
  const count = element.categories.length;
  if (count === 0) return 1;
  const slot = ((plot.right - plot.left) / count) * SLOT_FILL;
  return Math.max(
    1,
    ...element.categories.map((name) => wrapLabel(name, slot, metrics.size).length),
  );
}

/** Share of a category slot a label may take: a gap stays between neighbours. */
const SLOT_FILL = 0.92;

function Titles({
  element,
  box,
  plot,
  metrics,
}: {
  element: ChartElement;
  box: Box;
  plot: Plot;
  metrics: Metrics;
}): JSX.Element {
  return (
    <>
      {element.yTitle ? (
        <Label
          x={plot.left}
          y={metrics.size}
          text={element.yTitle}
          metrics={metrics}
          baseline="hanging"
        />
      ) : null}
      {element.xTitle ? (
        <Label
          x={(plot.left + plot.right) / 2}
          y={box.cy - metrics.size * 0.15}
          text={element.xTitle}
          metrics={metrics}
          anchor="middle"
        />
      ) : null}
    </>
  );
}

function plotOf(
  element: ChartElement,
  box: Box,
  metrics: Metrics,
  left: number,
  labelLines = 1,
): Plot {
  // A line of room over the tallest mark for its value.
  const top = metrics.size * (element.yTitle || element.series.length > 1 ? 3.4 : 1.6);
  const labels = (labelLines - 1) * LABEL_LINE;
  const bottom = box.cy - metrics.size * ((element.xTitle ? 3.2 : 2) + labels);
  return {
    left,
    right: box.cx - metrics.size * 0.4,
    top,
    bottom: Math.max(bottom, top + metrics.size),
  };
}

function Legend({
  element,
  profile,
  plot,
  metrics,
}: {
  element: ChartElement;
  profile: DesignSystem;
  plot: Plot;
  metrics: Metrics;
}): JSX.Element | null {
  if (element.series.length < 2) return null;
  const gap = metrics.size * 0.8;
  let x = plot.left;
  return (
    <>
      {element.series.map((series, index) => {
        const color = seriesPaint(profile.palette, index);
        const width = textWidthEmu(series.name, metrics.size);
        const mark = metrics.size * 0.7;
        const item = (
          <g key={`${index}:${series.name}`}>
            <Bar x={x} y={metrics.size * 0.15} width={mark} height={mark} fill={color} />
            <Label
              x={x + mark + metrics.size * 0.3}
              y={metrics.size * 0.95}
              text={series.name}
              metrics={metrics}
            />
          </g>
        );
        x += mark + width + gap;
        return item;
      })}
    </>
  );
}

function Columns({
  element,
  profile,
  plot,
  metrics,
}: {
  element: ChartElement;
  profile: DesignSystem;
  plot: Plot;
  metrics: Metrics;
}): JSX.Element {
  const domain = ids(element);
  const keys = element.series.map((_, index) => String(index));
  const { min, max } = extent(element);
  const x0 = scaleBand({ domain, range: [plot.left, plot.right], padding: 0.28 });
  const x1 = scaleBand({ domain: keys, range: [0, x0.bandwidth()], padding: 0.12 });
  const y = scaleLinear({ domain: [min, max], range: [plot.bottom, plot.top] });
  const baseline = y(0) ?? plot.bottom;
  return (
    <Group>
      <Line
        from={{ x: plot.left, y: baseline }}
        to={{ x: plot.right, y: baseline }}
        stroke={metrics.axis}
        strokeWidth={metrics.stroke}
      />
      {domain.map((id) =>
        keys.map((key) => {
          const series = Number(key);
          const amount = valueAt(element, series, Number(id));
          const y0 = y(0) ?? plot.bottom;
          const y1 = y(amount) ?? y0;
          const left = (x0(id) ?? 0) + (x1(key) ?? 0);
          return (
            <g key={`${id}-${key}`}>
              <Bar
                x={left}
                y={Math.min(y0, y1)}
                width={Math.max(x1.bandwidth(), 0)}
                height={Math.abs(y1 - y0)}
                fill={seriesPaint(profile.palette, series)}
              />
              <Label
                x={left + x1.bandwidth() / 2}
                y={amount < 0 ? y1 + metrics.size * 0.25 : y1 - metrics.size * 0.25}
                text={valueText(amount)}
                metrics={metrics}
                anchor="middle"
                baseline={amount < 0 ? 'hanging' : 'auto'}
              />
            </g>
          );
        }),
      )}
      {domain.map((id) => {
        const text = element.categories[Number(id)] ?? '';
        return (
          <Label
            key={`label-${id}`}
            x={(x0(id) ?? 0) + x0.bandwidth() / 2}
            y={plot.bottom + metrics.size * 0.35}
            text={text}
            lines={wrapLabel(text, x0.step() * SLOT_FILL, metrics.size)}
            metrics={metrics}
            anchor="middle"
            baseline="hanging"
          />
        );
      })}
    </Group>
  );
}

function Bars({
  element,
  profile,
  box,
  metrics,
}: {
  element: ChartElement;
  profile: DesignSystem;
  box: Box;
  metrics: Metrics;
}): JSX.Element {
  const domain = ids(element);
  const keys = element.series.map((_, index) => String(index));
  const widest = Math.max(
    0,
    ...element.categories.map((name) => textWidthEmu(name, metrics.size * EMU_PER_PT) / EMU_PER_PT),
  );
  const gutter = Math.min(widest + metrics.size * 0.6, box.cx * 0.46);
  const values = element.series.flatMap((series) => series.values);
  const valueWidth = Math.max(
    0,
    ...values.map(
      (value) => textWidthEmu(valueText(value), metrics.size * EMU_PER_PT) / EMU_PER_PT,
    ),
  );
  const base = plotOf(element, box, metrics, gutter);
  // The longest bar keeps room past its end for its value.
  const plot = {
    ...base,
    right: Math.max(base.right - valueWidth - metrics.size * 0.4, gutter + metrics.size),
  };
  const { min, max } = extent(element);
  const y0 = scaleBand({ domain, range: [plot.top, plot.bottom], padding: 0.22 });
  const y1 = scaleBand({ domain: keys, range: [0, y0.bandwidth()], padding: 0.12 });
  const x = scaleLinear({ domain: [min, max], range: [plot.left, plot.right] });
  const baseline = x(0) ?? plot.left;
  return (
    <Group>
      <Titles element={element} box={box} plot={plot} metrics={metrics} />
      <Legend element={element} profile={profile} plot={plot} metrics={metrics} />
      <Line
        from={{ x: baseline, y: plot.top }}
        to={{ x: baseline, y: plot.bottom }}
        stroke={metrics.axis}
        strokeWidth={metrics.stroke}
      />
      {domain.map((id) =>
        keys.map((key) => {
          const series = Number(key);
          const amount = valueAt(element, series, Number(id));
          const x0 = x(0) ?? plot.left;
          const x1 = x(amount) ?? x0;
          const top = (y0(id) ?? 0) + (y1(key) ?? 0);
          return (
            <g key={`${id}-${key}`}>
              <Bar
                x={Math.min(x0, x1)}
                y={top}
                width={Math.abs(x1 - x0)}
                height={Math.max(y1.bandwidth(), 0)}
                fill={seriesPaint(profile.palette, series)}
              />
              <Label
                x={amount < 0 ? x1 - metrics.size * 0.25 : x1 + metrics.size * 0.25}
                y={top + y1.bandwidth() / 2}
                text={valueText(amount)}
                metrics={metrics}
                anchor={amount < 0 ? 'end' : 'start'}
                baseline="middle"
              />
            </g>
          );
        }),
      )}
      {domain.map((id) => (
        <Label
          key={`label-${id}`}
          x={plot.left - metrics.size * 0.35}
          y={(y0(id) ?? 0) + y0.bandwidth() / 2}
          text={element.categories[Number(id)] ?? ''}
          metrics={metrics}
          anchor="end"
          baseline="middle"
        />
      ))}
    </Group>
  );
}

function Trend({
  element,
  profile,
  plot,
  metrics,
  area,
}: {
  element: ChartElement;
  profile: DesignSystem;
  plot: Plot;
  metrics: Metrics;
  area: boolean;
}): JSX.Element {
  const domain = ids(element);
  const { min, max } = extent(element);
  const x = scaleBand({ domain, range: [plot.left, plot.right], padding: 0.2 });
  const y = scaleLinear({ domain: [min, max], range: [plot.bottom, plot.top] });
  const baseline = y(0) ?? plot.bottom;
  return (
    <Group>
      <Line
        from={{ x: plot.left, y: baseline }}
        to={{ x: plot.right, y: baseline }}
        stroke={metrics.axis}
        strokeWidth={metrics.stroke}
      />
      {element.series.map((series, index) => {
        const points = domain.map((id) => ({
          x: (x(id) ?? 0) + x.bandwidth() / 2,
          y: y(series.values[Number(id)] ?? 0) ?? baseline,
        }));
        const color = seriesPaint(profile.palette, index);
        return (
          <Group key={series.name}>
            {area ? (
              <AreaClosed
                data={points}
                x={(point) => point.x}
                y={(point) => point.y}
                yScale={y}
                y0={baseline}
                curve={curveMonotoneX}
                fill={color}
                fillOpacity={0.35}
                stroke="none"
              />
            ) : null}
            <LinePath
              data={points}
              x={(point) => point.x}
              y={(point) => point.y}
              curve={curveMonotoneX}
              stroke={color}
              strokeWidth={metrics.stroke * 1.6}
              fill="none"
            />
            {points.map((point, at) => (
              <Label
                key={`value-${at}`}
                x={point.x}
                y={point.y - metrics.size * 0.4}
                text={valueText(series.values[at] ?? 0)}
                metrics={metrics}
                anchor="middle"
              />
            ))}
          </Group>
        );
      })}
      {domain.map((id) => {
        const text = element.categories[Number(id)] ?? '';
        return (
          <Label
            key={`label-${id}`}
            x={(x(id) ?? 0) + x.bandwidth() / 2}
            y={plot.bottom + metrics.size * 0.35}
            text={text}
            lines={wrapLabel(text, x.step() * SLOT_FILL, metrics.size)}
            metrics={metrics}
            anchor="middle"
            baseline="hanging"
          />
        );
      })}
    </Group>
  );
}

function PieChart({
  element,
  profile,
  box,
  metrics,
}: {
  element: ChartElement;
  profile: DesignSystem;
  box: Box;
  metrics: Metrics;
}): JSX.Element {
  const series = element.series[0];
  const slices = element.categories.map((label, index) => ({
    label,
    value: Math.max(series?.values[index] ?? 0, 0),
  }));
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  // Room around the pie for each slice's name and value.
  const radius = Math.min(box.cx * 0.28, box.cy * 0.34);
  if (total <= 0) {
    return (
      <Circle
        cx={box.cx / 2}
        cy={box.cy / 2}
        r={radius}
        fill={paint(profile.palette, 'surface', 'line')}
      />
    );
  }
  return (
    <Group left={box.cx / 2} top={box.cy / 2}>
      <Pie
        data={slices}
        pieValue={(slice) => slice.value}
        pieSort={null}
        pieSortValues={null}
        outerRadius={radius}
      >
        {(pie) =>
          pie.arcs.map((arc) => {
            const d = pie.path(arc);
            if (!d) return null;
            // The centroid sits at half the radius; the label goes just outside the slice.
            const [cx, cy] = pie.path.centroid(arc);
            const share = Math.round((arc.data.value / total) * 100);
            return (
              <g key={arc.index}>
                <path d={d} fill={seriesPaint(profile.palette, arc.index)} />
                <Label
                  x={cx * 2.3}
                  y={cy * 2.3}
                  text={`${arc.data.label}: ${valueText(arc.data.value)} (${share}%)`}
                  lines={[arc.data.label, `${valueText(arc.data.value)} · ${share}%`]}
                  metrics={metrics}
                  anchor={Math.abs(cx) < radius * 0.1 ? 'middle' : cx > 0 ? 'start' : 'end'}
                  baseline="middle"
                />
              </g>
            );
          })
        }
      </Pie>
    </Group>
  );
}

export function ChartMark({
  element,
  size,
  profile,
  thumbnail = false,
}: {
  element: ChartElement;
  size: SlideSize;
  profile: DesignSystem;
  thumbnail?: boolean;
}): JSX.Element {
  const { box } = element;
  const frame: Box = { x: 0, y: 0, cx: box.cx / EMU_PER_PT, cy: box.cy / EMU_PER_PT };
  const metrics = metricsOf(profile, frame, size.cy);
  const first = plotOf(element, frame, metrics, metrics.size * 0.5);
  // Long category names wrap under their column; the plot gives up the height they take.
  const plot = plotOf(
    element,
    frame,
    metrics,
    metrics.size * 0.5,
    labelLinesOf(element, first, metrics),
  );
  return (
    <div
      {...markHooks(element, thumbnail)}
      {...(thumbnail ? null : { 'data-chart-type': element.chartType })}
      style={{ ...markStyle(element, size), overflow: 'visible' }}
    >
      {frame.cx > 0 && frame.cy > 0 ? (
        <svg
          viewBox={`0 0 ${frame.cx} ${frame.cy}`}
          width="100%"
          height="100%"
          style={{ display: 'block', overflow: 'visible' }}
        >
          {element.chartType === 'pie' ? (
            <PieChart element={element} profile={profile} box={frame} metrics={metrics} />
          ) : element.chartType === 'bar' ? (
            <Bars element={element} profile={profile} box={frame} metrics={metrics} />
          ) : element.chartType === 'column' ? (
            <>
              <Titles element={element} box={frame} plot={plot} metrics={metrics} />
              <Legend element={element} profile={profile} plot={plot} metrics={metrics} />
              <Columns element={element} profile={profile} plot={plot} metrics={metrics} />
            </>
          ) : (
            <>
              <Titles element={element} box={frame} plot={plot} metrics={metrics} />
              <Legend element={element} profile={profile} plot={plot} metrics={metrics} />
              <Trend
                element={element}
                profile={profile}
                plot={plot}
                metrics={metrics}
                area={element.chartType === 'area'}
              />
            </>
          )}
        </svg>
      ) : null}
    </div>
  );
}
