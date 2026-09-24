import type { HTMLAttributes, JSX } from 'react';
import type { SlideSize } from './geometry.js';

export interface SlideFrameProps extends HTMLAttributes<HTMLDivElement> {
  /** Slide size in EMU, from the template. Sets the proportions; the host sets the width. */
  readonly size: SlideSize;
  /**
   * Cut off whatever lies past the slide edge, as PowerPoint and the export do. Off only for an
   * editor canvas that shows the pasteboard around the slide; the host then dims what is outside.
   */
  readonly clip?: boolean;
}

/**
 * The box a slide is drawn in: the template's proportions and a query container, so whatever is
 * inside measures itself in shares of the slide (`%` and `cqw`, see `boxStyle` and `ptToCqw`).
 *
 * It paints nothing of its own. Width, background, border and focus ring belong to the host, which
 * knows whether this is a thumbnail, the canvas or an export. Being a size container, the frame
 * needs a width from its parent: a block fills it, a flex or grid item needs one set.
 */
export function SlideFrame({
  size,
  clip = true,
  style,
  children,
  ...rest
}: SlideFrameProps): JSX.Element {
  return (
    <div
      {...rest}
      style={{
        position: 'relative',
        aspectRatio: `${size.cx} / ${size.cy}`,
        containerType: 'inline-size',
        // What lies past the slide edge is not on the slide, exactly as in PowerPoint.
        overflow: clip ? 'hidden' : 'visible',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
