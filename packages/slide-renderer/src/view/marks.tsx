import type { JSX } from 'react';
import type { Box, DesignSystem, SlideElement } from '@lct/contracts';
import { boxStyle, cqw, emuToCqw, type SlideSize } from '../geometry.js';
import { createTypeResolver, typeRoleOf } from '../schematic/text-layout.js';
import { fontFamily, paint } from './color.js';

type ImageElement = Extract<SlideElement, { kind: 'image' }>;
type TableElement = Extract<SlideElement, { kind: 'table' }>;
type DecorElement = Extract<SlideElement, { kind: 'decor' }>;

function hairline(size: SlideSize): string {
  return cqw(emuToCqw(Math.max(size.cx * 0.0012, 1), size));
}

/** A picture, contained or covered. With no address the box stays a frame. */
export function ImageMark({
  element,
  size,
  profile,
  resolveMedia,
}: {
  element: ImageElement;
  size: SlideSize;
  profile: DesignSystem;
  resolveMedia?: (mediaPart: string) => string | null;
}): JSX.Element {
  const url = resolveMedia?.(element.mediaPart) ?? null;
  const line = paint(profile.palette, 'line', 'text');
  return (
    <div
      data-kind="image"
      data-role={element.role}
      data-element-id={element.elementId}
      style={{
        ...boxStyle(element.box, size),
        overflow: 'hidden',
        background: url ? undefined : paint(profile.palette, 'surface', 'background'),
        boxShadow: url ? undefined : `inset 0 0 0 ${hairline(size)} ${line}`,
      }}
    >
      {url ? (
        <img
          alt=""
          src={url}
          style={{ display: 'block', width: '100%', height: '100%', objectFit: element.fit }}
        />
      ) : null}
    </div>
  );
}

export function TableMark({
  element,
  size,
  profile,
}: {
  element: TableElement;
  size: SlideSize;
  profile: DesignSystem;
}): JSX.Element {
  const type = createTypeResolver(profile, size.cy);
  const style = profile.typeScale.find((entry) => entry.role === typeRoleOf(element.role));
  const color = paint(profile.palette, style?.colorRole ?? 'text', 'text');
  const line = paint(profile.palette, 'line', 'text');
  const rule = `${hairline(size)} solid ${line}`;
  const rows = [element.headers, ...element.rows];
  return (
    <div
      data-kind="table"
      data-role={element.role}
      data-element-id={element.elementId}
      style={{ ...boxStyle(element.box, size), overflow: 'visible' }}
    >
      <table
        style={{
          width: '100%',
          height: '100%',
          borderCollapse: 'collapse',
          tableLayout: 'fixed',
          fontFamily: fontFamily(style?.font ?? ''),
          fontSize: cqw(emuToCqw(type.sizeEmu(element.role), size)),
          color,
          lineHeight: style?.lineSpacing ?? 1.2,
        }}
      >
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => {
                const header = rowIndex === 0;
                return (
                  <td
                    key={cellIndex}
                    style={{
                      padding: '0.35em 0.5em',
                      borderBottom: rule,
                      background: header
                        ? paint(profile.palette, 'surface', 'background')
                        : undefined,
                      fontWeight: header ? 700 : 400,
                      verticalAlign: 'top',
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'break-word',
                    }}
                  >
                    {cell}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Decoration carries no fill of its own. The box is the target, painted with a palette role
 * chosen from its share of the slide: a full-bleed panel and a small mark read as accent,
 * a card as surface, a rule as a line.
 */
function decorPaint(box: Box, size: SlideSize, profile: DesignSystem): string {
  const area = box.cx > 0 && box.cy > 0 ? (box.cx * box.cy) / (size.cx * size.cy) : 0;
  const thin = Math.min(box.cx, box.cy) / size.cx;
  if (box.cx === 0 || box.cy === 0 || thin <= 0.012)
    return paint(profile.palette, 'accent', 'line');
  if (area >= 0.5 || area <= 0.01) return paint(profile.palette, 'accent', 'text');
  return paint(profile.palette, 'surface', 'background');
}

export function DecorMark({
  element,
  size,
  profile,
}: {
  element: DecorElement;
  size: SlideSize;
  profile: DesignSystem;
}): JSX.Element | null {
  const { box } = element;
  if (box.cx < 0 || box.cy < 0 || box.cx + box.cy === 0) return null;
  const thickness = hairline(size);
  return (
    <div
      data-kind="decor"
      data-role={element.role}
      data-element-id={element.elementId}
      style={{
        ...boxStyle(box, size),
        background: decorPaint(box, size, profile),
        ...(box.cy === 0 ? { height: thickness } : null),
        ...(box.cx === 0 ? { width: thickness } : null),
      }}
    />
  );
}
