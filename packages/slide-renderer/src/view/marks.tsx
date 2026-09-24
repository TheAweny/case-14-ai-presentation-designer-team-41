import type { CSSProperties, JSX } from 'react';
import type { DesignSystem, ImageCrop, SlideElement } from '@lct/contracts';
import { cqw, emuToCqw, percent, type SlideSize } from '../geometry.js';
import { paint } from './color.js';
import { markHooks, markStyle } from './mark.js';

export { DecorMark } from './decor.js';
export { TableMark } from './table.js';

type ImageElement = Extract<SlideElement, { kind: 'image' }>;

function hairline(size: SlideSize): string {
  return cqw(emuToCqw(Math.max(size.cx * 0.0012, 1), size));
}

/** Less than this much of the picture left on an axis is no picture: the crop is ignored. */
const MIN_CROP_REST = 0.001;

/**
 * Where the whole picture lies relative to its box when it is cropped, as CSS percentages of the
 * box: the part that is left fills the box and the rest hangs outside it, cut off. Null when the
 * crop leaves nothing, and then the picture is placed by `fit` as if it had none.
 */
export function cropPlacement(crop: ImageCrop): CSSProperties | null {
  const restX = 1 - crop.l - crop.r;
  const restY = 1 - crop.t - crop.b;
  if (restX < MIN_CROP_REST || restY < MIN_CROP_REST) return null;
  return {
    position: 'absolute',
    left: percent((-crop.l / restX) * 100),
    top: percent((-crop.t / restY) * 100),
    width: percent(100 / restX),
    height: percent(100 / restY),
    maxWidth: 'none',
  };
}

/**
 * A picture, contained or covered. With no address the box stays a frame. A cropped picture shows
 * the part the crop leaves, filling the box: `a:srcRect` over `a:stretch`, as export writes it.
 */
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
  const placement = element.crop ? cropPlacement(element.crop) : null;
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
          draggable={false}
          style={
            placement
              ? { display: 'block', ...placement, objectFit: 'fill' }
              : { display: 'block', width: '100%', height: '100%', objectFit: element.fit }
          }
        />
      ) : null}
    </div>
  );
}
