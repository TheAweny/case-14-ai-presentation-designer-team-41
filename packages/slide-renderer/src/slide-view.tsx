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
}

/**
 * One slide of the IR, drawn with the template profile. Text stays as written: an overflow is a
 * mark, not a cut. Charts are visx shapes coloured by palette roles, in palette order.
 */
export function SlideView({ slide, profile, label, resolveMedia }: SlideViewProps): JSX.Element {
  const size = slideSizeOf(slide);
  return (
    <SlideFrame
      size={size}
      data-slide-root="true"
      aria-label={label}
      style={{
        background: paint(profile.palette, 'background', 'surface'),
        color: paint(profile.palette, 'text', 'background'),
      }}
    >
      {slide.elements.map((element, index) => {
        const key = `${index}:${element.elementId}`;
        switch (element.kind) {
          case 'text':
            return <TextMark key={key} element={element} size={size} profile={profile} />;
          case 'image':
            return (
              <ImageMark
                key={key}
                element={element}
                size={size}
                profile={profile}
                resolveMedia={resolveMedia}
              />
            );
          case 'table':
            return <TableMark key={key} element={element} size={size} profile={profile} />;
          case 'chart':
            return <ChartMark key={key} element={element} size={size} profile={profile} />;
          case 'decor':
            return <DecorMark key={key} element={element} size={size} profile={profile} />;
        }
      })}
    </SlideFrame>
  );
}
