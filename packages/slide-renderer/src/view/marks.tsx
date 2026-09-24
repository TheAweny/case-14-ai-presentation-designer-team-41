import type { JSX } from 'react';
import type { DesignSystem, SlideElement } from '@lct/contracts';
import { cqw, emuToCqw, type SlideSize } from '../geometry.js';
import { paint } from './color.js';
import { markHooks, markStyle } from './mark.js';

export { DecorMark } from './decor.js';
export { TableMark } from './table.js';

type ImageElement = Extract<SlideElement, { kind: 'image' }>;

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
