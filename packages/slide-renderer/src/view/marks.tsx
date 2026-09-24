import type { JSX } from 'react';
import type { DesignSystem, SlideElement } from '@lct/contracts';
import { cqw, emuToCqw, type SlideSize } from '../geometry.js';
import { createTypeResolver, typeRoleOf } from '../schematic/text-layout.js';
import { fontFamily, paint } from './color.js';
import { markHooks, markStyle } from './mark.js';

export { DecorMark } from './decor.js';

type ImageElement = Extract<SlideElement, { kind: 'image' }>;
type TableElement = Extract<SlideElement, { kind: 'table' }>;

function hairline(size: SlideSize): string {
  return cqw(emuToCqw(Math.max(size.cx * 0.0012, 1), size));
}

/** A picture, contained or covered. With no address the box stays a frame. */
export function ImageMark({
  element,
  size,
  profile,
  resolveMedia,
  thumbnail = false,
}: {
  element: ImageElement;
  size: SlideSize;
  profile: DesignSystem;
  resolveMedia?: (mediaPart: string) => string | null;
  thumbnail?: boolean;
}): JSX.Element {
  const url = resolveMedia?.(element.mediaPart) ?? null;
  const line = paint(profile.palette, 'line', 'text');
  return (
    <div
      {...markHooks(element, thumbnail)}
      style={{
        ...markStyle(element, size),
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
  thumbnail = false,
}: {
  element: TableElement;
  size: SlideSize;
  profile: DesignSystem;
  thumbnail?: boolean;
}): JSX.Element {
  const type = createTypeResolver(profile, size.cy);
  const style = profile.typeScale.find((entry) => entry.role === typeRoleOf(element.role));
  const color = paint(profile.palette, style?.colorRole ?? 'text', 'text');
  const line = paint(profile.palette, 'line', 'text');
  const rule = `${hairline(size)} solid ${line}`;
  const rows = [element.headers, ...element.rows];
  return (
    <div
      {...markHooks(element, thumbnail)}
      style={{ ...markStyle(element, size), overflow: 'visible' }}
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
