import type {
  Box,
  ColorRole,
  DesignSystem,
  ElementRole,
  SlideElement,
  SlideIr,
  StyleSource,
  TokenMeta,
} from '@lct/contracts';

/**
 * Hand-made slides for the audit tests, on a 16:9 slide of 960 × 540 pt. Coordinates are in
 * points and turned into EMU here, so a test reads like the slide it describes.
 */

const EMU_PER_PT = 12_700;
export const pt = (value: number): number => Math.round(value * EMU_PER_PT);

export const SLIDE = { cx: pt(960), cy: pt(540) };

function meta(source: StyleSource = 'observed'): TokenMeta {
  return { source, count: 1, share: 1, confidence: 1, parts: [] };
}

export function box(x: number, y: number, cx: number, cy: number): Box {
  return { x: pt(x), y: pt(y), cx: pt(cx), cy: pt(cy) };
}

const PALETTE: Record<ColorRole, string> = {
  background: 'FFFFFF',
  surface: 'F2F2F2',
  text: '1A1A1A',
  'text-muted': '6B6B6B',
  'text-on-accent': 'FFFFFF',
  accent: '0055FF',
  'accent-alt': 'FF7A00',
  line: 'D0D0D0',
  positive: '1E9E4A',
  negative: 'D62828',
};

export function designSystem(gridSource: StyleSource = 'observed'): DesignSystem {
  return {
    schemaVersion: 1,
    templateHash: '0'.repeat(64),
    aspect: '16:9',
    palette: Object.entries(PALETTE).map(([role, hex]) => ({
      role: role as ColorRole,
      hex,
      meta: meta(),
    })),
    surfaces: [
      { tone: 'light', background: 'FFFFFF', text: '1A1A1A', accent: '0055FF', meta: meta() },
    ],
    typeFamilies: [{ role: 'primary', font: 'Inter', declared: 'Inter', meta: meta() }],
    typeScale: [
      {
        role: 'title',
        font: 'Inter',
        sizePt: 36,
        bold: true,
        italic: false,
        lineSpacing: 1.1,
        colorRole: 'text',
        meta: meta(),
      },
      {
        role: 'body',
        font: 'Inter',
        sizePt: 16,
        bold: false,
        italic: false,
        lineSpacing: 1.2,
        colorRole: 'text',
        meta: meta(),
      },
    ],
    grid: {
      slideCx: SLIDE.cx,
      slideCy: SLIDE.cy,
      marginLeft: pt(48),
      marginRight: pt(48),
      marginTop: pt(36),
      marginBottom: pt(36),
      columns: 12,
      gutter: pt(16),
      baseline: pt(4),
      meta: meta(gridSource),
    },
    strokes: [],
    radii: [],
    shadows: { present: false, meta: meta() },
    protectedZones: [],
    warnings: [],
  };
}

export function text(
  elementId: string,
  frame: Box,
  words: string,
  options: { role?: ElementRole; color?: string; font?: string; sizePt?: number } = {},
): Extract<SlideElement, { kind: 'text' }> {
  return {
    kind: 'text',
    elementId,
    role: options.role ?? 'body',
    box: frame,
    sourceShapeId: null,
    paragraphs: [
      {
        level: 0,
        runs: [
          {
            text: words,
            font: options.font ?? '',
            sizePt: options.sizePt ?? null,
            bold: null,
            italic: null,
            color: options.color ?? '',
          },
        ],
        lineSpacing: null,
      },
    ],
    overflow: null,
  };
}

export function image(elementId: string, frame: Box): Extract<SlideElement, { kind: 'image' }> {
  return {
    kind: 'image',
    elementId,
    role: 'image',
    box: frame,
    sourceShapeId: null,
    mediaPart: `/ppt/media/${elementId}.png`,
    fit: 'cover',
  };
}

export function shape(
  elementId: string,
  frame: Box,
  fill: string | null,
): Extract<SlideElement, { kind: 'decor' }> {
  return {
    kind: 'decor',
    elementId,
    role: 'decoration',
    box: frame,
    sourceShapeId: null,
    shape: 'rect',
    fill: fill as Extract<SlideElement, { kind: 'decor' }>['fill'],
    stroke: null,
  };
}

export function slide(elements: SlideElement[], options: Partial<SlideIr> = {}): SlideIr {
  return {
    schemaVersion: 1,
    slideId: 's1',
    variant: 'balanced',
    index: 0,
    patternId: 'content',
    slideCx: SLIDE.cx,
    slideCy: SLIDE.cy,
    elements,
    ...options,
  };
}
