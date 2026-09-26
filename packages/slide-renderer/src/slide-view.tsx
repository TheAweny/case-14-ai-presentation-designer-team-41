import type { JSX } from 'react';
import type { Box, DesignSystem, SlideIr } from '@lct/contracts';
import { slideSizeOf, type SlideSize } from './geometry.js';
import { SlideFrame } from './slide-frame.js';
import { ChartMark } from './view/chart.js';
import { paint, resolveColor } from './view/color.js';
import { markStyle } from './view/mark.js';
import { DecorMark, ImageMark, TableMark } from './view/marks.js';
import type { TextElement } from './schematic/text-layout.js';
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
  /**
   * Draw the parts of elements that lie past the slide edge instead of cutting them off: an
   * editor canvas with a pasteboard around the slide. Thumbnails, previews and exports keep the
   * cut, and a thumbnail ignores this flag.
   */
  readonly showOutside?: boolean;
  /**
   * What a text box with no text says in place of it, such as a prompt in an empty placeholder of
   * a template layout, drawn faded inside a dashed outline. Null keeps the box empty. Absent, as in
   * a show or an export, no box shows a prompt: the renderer has no strings of its own.
   */
  readonly emptyText?: (element: TextElement) => string | null;
}

/** The box reaches past the slide edge, at least in part. */
function pastEdge(box: Box, size: SlideSize): boolean {
  return box.x < 0 || box.y < 0 || box.x + box.cx > size.cx || box.y + box.cy > size.cy;
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
  showOutside = false,
  emptyText,
}: SlideViewProps): JSX.Element {
  const size = slideSizeOf(slide);
  const background = resolveColor(
    profile.palette,
    slide.background ?? 'background',
    'background',
    'surface',
  );
  const outside = showOutside && !thumbnail;
  const hooks = thumbnail
    ? { 'aria-hidden': true }
    : { 'data-slide-root': 'true', 'data-slide-id': slide.slideId, 'aria-label': label };
  return (
    <SlideFrame
      size={size}
      clip={!outside}
      className={className}
      {...hooks}
      style={{
        background,
        color: paint(profile.palette, 'text', 'background'),
        ...(thumbnail ? { pointerEvents: 'none', userSelect: 'none' } : null),
      }}
    >
      {/*
       * Past the edge, an element keeps a patch of the slide background behind it: text written
       * for this slide stays readable over the host's canvas, whatever colour that is. Inside the
       * slide the patch matches the slide and cannot be seen. All patches go first, under every
       * element.
       */}
      {outside
        ? slide.elements
            .filter((element) => pastEdge(element.box, size))
            .map((element) => (
              <div
                key={`backdrop-${element.elementId}`}
                aria-hidden
                data-outside-backdrop=""
                style={{
                  ...markStyle({ box: element.box, rotation: element.rotation }, size),
                  background,
                  pointerEvents: 'none',
                }}
              />
            ))
        : null}
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
                emptyText={emptyText}
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
