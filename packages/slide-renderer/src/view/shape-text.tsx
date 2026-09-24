import type { CSSProperties, JSX } from 'react';
import type {
  DesignSystem,
  ElementRole,
  PaletteEntry,
  SlideElement,
  TextInsets,
  VerticalAlign,
} from '@lct/contracts';
import { cqw, emuToCqw, type SlideSize } from '../geometry.js';
import { createTypeResolver, typeRoleOf } from '../schematic/text-layout.js';
import { fontFamily, paint } from './color.js';
import { ParagraphView } from './text.js';

type DecorElement = Extract<SlideElement, { kind: 'decor' }>;

/**
 * Words in a shape take the type of body copy, whatever the role of the shape: in OOXML they come
 * from the master's `p:otherStyle`, which a template states like its body text.
 */
export const SHAPE_TEXT_ROLE: ElementRole = 'body';

/** `a:bodyPr` insets PowerPoint uses when a shape states none: 0.1 inch across, 0.05 inch down. */
export const DEFAULT_TEXT_INSETS: TextInsets = { l: 91_440, t: 45_720, r: 91_440, b: 45_720 };

const ANCHOR: Record<VerticalAlign, CSSProperties['justifyContent']> = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
};

/** Whether a shape of this geometry can hold text. A line cannot, as in PowerPoint. */
export function holdsText(element: Pick<DecorElement, 'shape'>): boolean {
  return element.shape !== 'line';
}

/** Relative luminance of `#rrggbb`, as WCAG defines it. Null for anything else. */
function luminance(css: string): number | null {
  const hex = /^#([0-9a-fA-F]{6})$/.exec(css)?.[1];
  if (!hex) return null;
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.039_28 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrast(left: number, right: number): number {
  const [light, dark] = left > right ? [left, right] : [right, left];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * The colour of words in a shape that do not state one: of the two type colours the palette has,
 * the one that reads better on the fill. On an accent that is usually `text-on-accent`, on a card
 * the body text colour. A shape with no fill shows the slide through, so its words are body text.
 */
export function shapeTextColor(palette: readonly PaletteEntry[], fill: string | null): string {
  const body = paint(palette, 'text');
  if (!fill) return body;
  const onAccent = paint(palette, 'text-on-accent', 'background');
  const ground = luminance(fill);
  const bodyLum = luminance(body);
  const onAccentLum = luminance(onAccent);
  if (ground === null || bodyLum === null || onAccentLum === null) return body;
  return contrast(onAccentLum, ground) > contrast(bodyLum, ground) ? onAccent : body;
}

/**
 * What words in a shape inherit when their runs say nothing: the body type of the profile, in
 * the colour that reads on the fill. The editor opens its text field with the same look.
 */
export function shapeTextLook(profile: DesignSystem, slideCy: number, fill: string | null) {
  const role = typeRoleOf(SHAPE_TEXT_ROLE);
  const style = profile.typeScale.find((entry) => entry.role === role);
  const type = createTypeResolver(profile, slideCy);
  return {
    font: style?.font ?? '',
    fontFamily: fontFamily(style?.font ?? ''),
    sizeEmu: type.sizeEmu(SHAPE_TEXT_ROLE),
    sizePt: style?.sizePt ?? null,
    bold: type.bold(SHAPE_TEXT_ROLE),
    italic: type.italic(SHAPE_TEXT_ROLE),
    lineHeight: type.lineSpacing(SHAPE_TEXT_ROLE),
    color: shapeTextColor(profile.palette, fill),
  };
}

/** Insets of a shape's text as CSS padding, in `cqw` so they scale with the slide. */
export function shapeTextPadding(
  element: Pick<DecorElement, 'textInsets'>,
  size: SlideSize,
): CSSProperties {
  const insets = element.textInsets ?? DEFAULT_TEXT_INSETS;
  return {
    paddingLeft: cqw(emuToCqw(insets.l, size)),
    paddingTop: cqw(emuToCqw(insets.t, size)),
    paddingRight: cqw(emuToCqw(insets.r, size)),
    paddingBottom: cqw(emuToCqw(insets.b, size)),
  };
}

/**
 * The words of a shape, laid over its drawing. They are centred both ways unless the paragraphs
 * or `verticalAlign` say otherwise, as they are in a PowerPoint shape, and they wrap inside the
 * insets; words that do not fit spill past the shape rather than being cut.
 */
export function ShapeText({
  element,
  size,
  profile,
  fill,
}: {
  element: DecorElement;
  size: SlideSize;
  profile: DesignSystem;
  /** The fill the shape is drawn with, as CSS, or null when the slide shows through. */
  fill: string | null;
}): JSX.Element | null {
  const paragraphs = element.paragraphs;
  if (!paragraphs || paragraphs.length === 0 || !holdsText(element)) return null;
  const look = shapeTextLook(profile, size.cy, fill);
  return (
    <div
      data-shape-text=""
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: ANCHOR[element.verticalAlign ?? 'middle'],
        textAlign: 'center',
        overflow: 'visible',
        color: look.color,
        ...shapeTextPadding(element, size),
      }}
    >
      {paragraphs.map((paragraph, index) => (
        <ParagraphView
          key={index}
          paragraph={paragraph}
          size={size}
          typeSizeEmu={look.sizeEmu}
          styleFont={look.font}
          styleBold={look.bold}
          styleItalic={look.italic}
          styleSizePt={look.sizePt}
          inherited={look.color}
          lineHeight={look.lineHeight}
          bulleted={false}
          first={index === 0}
        />
      ))}
    </div>
  );
}
