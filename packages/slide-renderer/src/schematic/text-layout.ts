import type {
  DesignSystem,
  ElementRole,
  Paragraph,
  SlideElement,
  TypeRole,
  TypeStyle,
} from '@lct/contracts';
import { EMU_PER_PT } from '../geometry.js';

/**
 * Where the lines of a text element would fall, estimated without a font.
 *
 * The schematic draws text as bars, one per line, and the number of lines and the length of each
 * come from the actual copy: words are wrapped greedily into the width of the box using average
 * glyph advances. It is an estimate — the renderer and the engine measure real fonts — but it is a
 * deterministic one, and a paragraph that wraps to three lines on the slide shows three bars here.
 *
 * Everything is in EMU relative to the element box, so the caller only has to scale.
 */

export type TextElement = Extract<SlideElement, { kind: 'text' }>;

/** A text element inherits size and spacing from the type role that matches its element role. */
const TYPE_ROLE: Record<ElementRole, TypeRole> = {
  title: 'title',
  subtitle: 'subtitle',
  body: 'body',
  'bullet-list': 'bullet',
  'kpi-value': 'kpi-value',
  'kpi-caption': 'kpi-caption',
  quote: 'quote',
  table: 'body',
  chart: 'caption',
  image: 'caption',
  logo: 'caption',
  footer: 'footer',
  'page-number': 'footer',
  decoration: 'caption',
};

/** The type role a slide element inherits, when its runs do not say. */
export function typeRoleOf(role: ElementRole): TypeRole {
  return TYPE_ROLE[role];
}

/**
 * Sizes for text that inherits one when no type scale is at hand, as a share of the slide height.
 * They are the proportions of an ordinary deck, not of any template, and only matter when both
 * the run and the design system are silent.
 */
const FALLBACK_SIZE: Record<TypeRole, number> = {
  title: 0.06,
  subtitle: 0.034,
  heading: 0.037,
  body: 0.03,
  bullet: 0.03,
  caption: 0.022,
  'kpi-value': 0.09,
  'kpi-caption': 0.026,
  quote: 0.048,
  footer: 0.019,
};

const FALLBACK_BOLD: ReadonlySet<TypeRole> = new Set(['title', 'heading', 'kpi-value']);
const FALLBACK_ITALIC: ReadonlySet<TypeRole> = new Set(['quote']);

/** Single spacing, the line pitch of a paragraph that states none. */
const FALLBACK_LINE_SPACING = 1.2;

/** What a text element inherits when its runs do not say. */
export interface TypeResolver {
  sizeEmu(role: ElementRole): number;
  bold(role: ElementRole): boolean;
  italic(role: ElementRole): boolean;
  /** Line pitch as a multiple of the type size. */
  lineSpacing(role: ElementRole): number;
}

export function createTypeResolver(
  designSystem: Pick<DesignSystem, 'typeScale'> | undefined,
  slideCy: number,
): TypeResolver {
  const styles = new Map<TypeRole, TypeStyle>();
  for (const style of designSystem?.typeScale ?? []) styles.set(style.role, style);
  const styleOf = (role: ElementRole) => styles.get(TYPE_ROLE[role]);

  return {
    sizeEmu: (role) => {
      const style = styleOf(role);
      return style ? style.sizePt * EMU_PER_PT : FALLBACK_SIZE[TYPE_ROLE[role]] * slideCy;
    },
    bold: (role) => styleOf(role)?.bold ?? FALLBACK_BOLD.has(TYPE_ROLE[role]),
    italic: (role) => styleOf(role)?.italic ?? FALLBACK_ITALIC.has(TYPE_ROLE[role]),
    lineSpacing: (role) => styleOf(role)?.lineSpacing ?? FALLBACK_LINE_SPACING,
  };
}

/*
 * Average advances in em for a sans-serif face. Coarse classes are enough: what matters is that a
 * line of wide capitals comes out longer than a line of narrow lowercase, as it would on the slide.
 */
const NARROW = new Set([...`.,:;!'"|()[]{}ijlrtfIіїґ`]);
const WIDE_LOWER = new Set([...'mwшщжюыфм']);
const WIDE_UPPER = new Set([...'MWШЩЖЮЫФМ']);
const BOLD_WIDTH = 1.05;

/** Line feed, the vertical tab OOXML writes for a soft break, and the Unicode line separator. */
const BREAK = new Set(['\n', '\v', String.fromCharCode(0x2028)]);
/** Any other whitespace, the no-break space included, separates words. */
const SPACE = /\s/;

function advanceEm(char: string): number {
  if (SPACE.test(char)) return 0.27;
  if (char === '—') return 0.9;
  if (NARROW.has(char)) return 0.3;
  if (char >= '0' && char <= '9') return 0.58;
  if (WIDE_UPPER.has(char)) return 0.88;
  if (WIDE_LOWER.has(char)) return 0.8;
  if (char !== char.toLowerCase()) return 0.68;
  return 0.54;
}

/** Estimated width of a string set at `sizeEmu`, in EMU. */
export function textWidthEmu(text: string, sizeEmu: number, bold = false): number {
  let em = 0;
  for (const char of text) em += advanceEm(char);
  return em * sizeEmu * (bold ? BOLD_WIDTH : 1);
}

type Token = { readonly kind: 'word'; readonly gap: number; readonly width: number } | 'break';

/** Extra advance after every character of a run, in EMU: its letter spacing, zero when unset. */
function trackingEmu(run: Paragraph['runs'][number]): number {
  const pt = run.letterSpacingPt;
  return pt !== null && pt !== undefined && Number.isFinite(pt) ? pt * EMU_PER_PT : 0;
}

/**
 * Words with the width of the space before each, across runs of different size, weight and
 * letter spacing. Tracking goes after every character, spaces included, as CSS and PowerPoint
 * both apply it.
 */
function tokenize(
  paragraph: Paragraph,
  sizeOf: (sizePt: number | null) => number,
  boldOf: (bold: boolean | null) => boolean,
): Token[] {
  const tokens: Token[] = [];
  let gap = 0;
  let width = 0;
  let inWord = false;
  const flush = () => {
    if (inWord) tokens.push({ kind: 'word', gap, width });
    gap = 0;
    width = 0;
    inWord = false;
  };
  for (const run of paragraph.runs) {
    const size = sizeOf(run.sizePt);
    const factor = boldOf(run.bold) ? BOLD_WIDTH : 1;
    const tracking = trackingEmu(run);
    for (const char of run.text) {
      if (BREAK.has(char)) {
        flush();
        tokens.push('break');
      } else if (SPACE.test(char)) {
        if (inWord) flush();
        gap += Math.max(advanceEm(' ') * size + tracking, 0);
      } else {
        // Tight tracking narrows a glyph, but never below nothing.
        width += Math.max(advanceEm(char) * size * factor + tracking, 0);
        inWord = true;
      }
    }
  }
  flush();
  return tokens;
}

/** Greedy wrap into `available`; returns the width of every line, an empty paragraph included. */
function wrap(tokens: readonly Token[], available: number): number[] {
  const lines: number[] = [];
  let current = 0;
  let empty = true;
  for (const token of tokens) {
    if (token === 'break') {
      lines.push(current);
      current = 0;
      empty = true;
      continue;
    }
    if (!empty && current + token.gap + token.width <= available) {
      current += token.gap + token.width;
      continue;
    }
    if (!empty) lines.push(current);
    // A word longer than the line breaks across lines, as it does in PowerPoint.
    let rest = token.width;
    while (rest > available) {
      lines.push(available);
      rest -= available;
    }
    current = rest;
    empty = false;
  }
  lines.push(current);
  return lines;
}

/*
 * Proportions of a line, in em of the paragraph's type size. A bar is about as thick as the
 * lowercase letters are tall, a little more when the text is bold. Figures and capitals stand
 * taller, so a line set mostly in them — a key figure, a page number — gets the cap height.
 */
const BAR = 0.5;
const BAR_BOLD = 0.56;
const BAR_CAPS = 0.68;

/** Whether most visible characters of the paragraph are figures or capitals. */
function setInCaps(paragraph: Paragraph): boolean {
  let tall = 0;
  let visible = 0;
  for (const run of paragraph.runs) {
    for (const char of run.text) {
      if (SPACE.test(char)) continue;
      visible += 1;
      if ((char >= '0' && char <= '9') || char !== char.toLowerCase()) tall += 1;
    }
  }
  return visible > 0 && tall * 2 > visible;
}
const INDENT_PER_LEVEL = 1.5;
const BULLET_HANG = 1.1;
const MARKER = 0.3;
const PARAGRAPH_GAP = 0.3;

export interface TextBar {
  /** Offsets from the top left of the element box, in EMU. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly thickness: number;
  /** Type size of the line, in EMU. */
  readonly size: number;
  readonly bold: boolean;
  readonly italic: boolean;
  /** Index of the paragraph this line belongs to. */
  readonly paragraph: number;
}

export interface TextMarker {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly paragraph: number;
}

export interface TextLayout {
  /** Lines that fit in the box, top to bottom. */
  readonly bars: readonly TextBar[];
  readonly markers: readonly TextMarker[];
  /** Lines the text wraps to, including those the box cuts off. */
  readonly estimatedLines: number;
}

function majority(
  paragraph: Paragraph,
  pick: (run: Paragraph['runs'][number]) => boolean,
): boolean {
  let yes = 0;
  let no = 0;
  for (const run of paragraph.runs) {
    const weight = Math.max(run.text.length, 1);
    if (pick(run)) yes += weight;
    else no += weight;
  }
  return yes > no;
}

export function layoutText(element: TextElement, type: TypeResolver): TextLayout {
  const { role, box } = element;
  const bulleted = role === 'bullet-list';
  const sizeOf = (sizePt: number | null) =>
    sizePt === null ? type.sizeEmu(role) : sizePt * EMU_PER_PT;
  const boldOf = (bold: boolean | null) => bold ?? type.bold(role);

  const bars: TextBar[] = [];
  const markers: TextMarker[] = [];
  let estimatedLines = 0;
  let y = 0;
  let full = false;

  element.paragraphs.forEach((paragraph, index) => {
    const size = paragraph.runs.reduce(
      (largest, run) => Math.max(largest, sizeOf(run.sizePt)),
      paragraph.runs.length === 0 ? type.sizeEmu(role) : 0,
    );
    const bold = majority(paragraph, (run) => boldOf(run.bold));
    const italic = majority(paragraph, (run) => run.italic ?? type.italic(role));
    // A paragraph that states its own spacing wins over the one its type role gives.
    const pitch = size * (paragraph.lineSpacing ?? type.lineSpacing(role));
    const thickness = size * (setInCaps(paragraph) ? BAR_CAPS : bold ? BAR_BOLD : BAR);
    const indent = paragraph.level * INDENT_PER_LEVEL * size;
    const textX = indent + (bulleted ? BULLET_HANG * size : 0);
    const room = Math.max(box.cx - textX, 0);
    // Wrapping into nothing would never end: a box too narrow for its indent gets one em.
    const available = Math.max(room, size);

    const lines = wrap(tokenize(paragraph, sizeOf, boldOf), available);
    estimatedLines += lines.length;
    if (index > 0) y += PARAGRAPH_GAP * size;

    lines.forEach((width, line) => {
      const top = y + (pitch - thickness) / 2;
      if (!full && top + thickness <= box.cy) {
        const drawn = Math.min(Math.max(width, thickness), room);
        if (width > 0 && drawn > 0) {
          bars.push({
            x: textX,
            y: top,
            width: drawn,
            thickness,
            size,
            bold,
            italic,
            paragraph: index,
          });
        }
        if (bulleted && line === 0) {
          const markerSize = MARKER * size;
          markers.push({
            x: indent,
            y: top + (thickness - markerSize) / 2,
            size: markerSize,
            paragraph: index,
          });
        }
      } else {
        // Text flows: once a line falls off the bottom, everything after it does too.
        full = true;
      }
      y += pitch;
    });
  });

  return { bars, markers, estimatedLines };
}
