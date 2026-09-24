import type { JSX } from 'react';
import type { DesignSystem, SlideIr } from '@lct/contracts';
import { slideSizeOf } from './geometry.js';
import { SlideFrame } from './slide-frame.js';
import { ChartMark } from './view/chart.js';
import { paint } from './view/color.js';
import { DecorMark, ImageMark, TableMark } from './view/marks.js';
import { TextMark } from './view/text.js';

export interface SlideViewProps {
  /** One laid-out slide of the engine IR. */
  readonly slide: SlideIr;
  /** Template profile: palette, type scale and grid extracted from the uploaded template. */
  readonly profile: DesignSystem;
  /** What the slide shows, for the host's language. The renderer has no strings of its own. */
  readonly label?: string;
  /**
   * Address of a picture by its `mediaPart`. Missing or null, the box is a frame: the renderer
   * does not invent a picture.
   */
  readonly resolveMedia?: (mediaPart: string) => string | null;
  /** Host chrome on the frame, such as the canvas corner radius. */
  readonly className?: string;
  /**
   * A miniature for a slide list. The slide looks the same, but it is inert: no overflow marks,
   * no `data-*` hooks the editor looks elements up by, hidden from assistive technology (the
   * host labels the list item) and transparent to the pointer.
   */
  readonly thumbnail?: boolean;
}

/**
 * One slide of the IR, drawn with the template profile. Text stays as written: an overflow is a
 * mark, not a cut. Charts are visx shapes coloured by palette roles.
 */
export function SlideView({
  slide,
  profile,
  label,
  resolveMedia,
  className,
  thumbnail = false,
}: SlideViewProps): JSX.Element {
  const size = slideSizeOf(slide);
  const hooks = thumbnail
    ? { 'aria-hidden': true }
    : { 'data-slide-root': 'true', 'data-slide-id': slide.slideId, 'aria-label': label };
  return (
    <SlideFrame
      size={size}
      className={className}
      {...hooks}
      style={{
        background: paint(
          profile.palette,
          slide.background ?? 'background',
          'background',
          'surface',
        ),
        color: paint(profile.palette, 'text', 'background'),
        ...(thumbnail ? { pointerEvents: 'none', userSelect: 'none' } : null),
      }}
    >
      {slide.elements.map((element) => {
        // Keyed by id, not by position: inserting or removing one element keeps the DOM of the rest.
        const key = element.elementId;
        switch (element.kind) {
          case 'text':
            return (
              <TextMark
                key={key}
                element={element}
                size={size}
                profile={profile}
                thumbnail={thumbnail}
              />
            );
          case 'image':
            return (
              <ImageMark
                key={key}
                element={element}
                size={size}
                profile={profile}
                resolveMedia={resolveMedia}
                thumbnail={thumbnail}
              />
            );
          case 'table':
            return (
              <TableMark
                key={key}
                element={element}
                size={size}
                profile={profile}
                thumbnail={thumbnail}
              />
            );
          case 'chart':
            return (
              <ChartMark
                key={key}
                element={element}
                size={size}
                profile={profile}
                thumbnail={thumbnail}
              />
            );
          case 'decor':
            return (
              <DecorMark
                key={key}
                element={element}
                size={size}
                profile={profile}
                thumbnail={thumbnail}
              />
            );
        }
      })}
    </SlideFrame>
  );
}
