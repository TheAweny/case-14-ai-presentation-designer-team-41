import { memo, type HTMLAttributes, type JSX } from 'react';
import type { DesignSystem, SlideIr } from '@lct/contracts';
import { slideSizeOf } from '../geometry.js';
import { SlideFrame } from '../slide-frame.js';
import { SchematicElement } from './elements.js';
import { inkVariables } from './ink.js';
import { createTypeResolver } from './text-layout.js';

export interface SlideSchematicProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'children' | 'role' | 'aria-label'
> {
  readonly slide: SlideIr;
  /** What the picture shows, in the reader's language. The library has no strings of its own. */
  readonly 'aria-label': string;
  /**
   * The template's type scale, for runs that inherit their size, weight or line spacing. Without
   * it the schematic falls back to ordinary proportions of a deck.
   */
  readonly designSystem?: Pick<DesignSystem, 'typeScale'>;
}

const INK = inkVariables();

/**
 * A slide drawn as its structure: every element of the IR in its own box, in paint order, as
 * bars, frames and marks in one ink. It stands in for the slide where the real rendering is not
 * available or not wanted — thumbnails, the canvas while the renderer is missing, placeholders.
 *
 * The ink is `currentColor`; the host sets `color` and a background, or `--schematic-ink` and
 * `--schematic-surface`. Nothing is measured at runtime, so the same slide always produces the
 * same markup.
 */
function SlideSchematicView({
  slide,
  designSystem,
  style,
  ...rest
}: SlideSchematicProps): JSX.Element {
  const size = slideSizeOf(slide);
  const type = createTypeResolver(designSystem, slide.slideCy);
  return (
    <SlideFrame size={size} role="img" {...rest} style={{ ...INK, ...style }}>
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          // Unset, the variable makes this transparent and the host's own background shows.
          backgroundColor: 'var(--schematic-surface)',
        }}
      >
        {slide.elements.map((element, index) => (
          <SchematicElement
            key={`${index}:${element.elementId}`}
            element={element}
            size={size}
            type={type}
          />
        ))}
      </div>
    </SlideFrame>
  );
}

export const SlideSchematic = memo(SlideSchematicView);
