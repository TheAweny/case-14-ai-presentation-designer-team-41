import type { CSSProperties, JSX } from 'react';
import type {
  DesignSystem,
  Paragraph,
  ParagraphAlign,
  TextRun,
  VerticalAlign,
} from '@lct/contracts';
import { EMU_PER_PT, cqw, emuToCqw, ptToCqw, type SlideSize } from '../geometry.js';
import {
  createTypeResolver,
  lineHeightOf,
  typeRoleOf,
  type TextElement,
} from '../schematic/text-layout.js';
import { fontFamily, paint } from './color.js';
import { markHooks, markStyle } from './mark.js';

function runColor(color: string, fallback: string): string {
  return /^[0-9a-fA-F]{6}$/.test(color) ? `#${color}` : fallback;
}

/** Where the lines sit in a box taller than they are. PowerPoint's default anchor is the top. */
const ANCHOR: Record<VerticalAlign, CSSProperties['justifyContent']> = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
};

const ALIGN: Record<ParagraphAlign, CSSProperties['textAlign']> = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'justify',
};

function showBreaks(text: string): string {
  return text.replaceAll('\v', '\n').replaceAll('\u2028', '\n');
}

/**
 * Whether the paragraphs state their own layout: a bullet, a margin, an indent or spacing, as a
 * deck read back from its .pptx does. Such text is laid out as stated, and what a paragraph leaves
 * out reads as OOXML's default, none; text that states none of it keeps the renderer's own gaps.
 */
export function statesParagraphLayout(paragraphs: readonly Paragraph[]): boolean {
  return paragraphs.some(
    (paragraph) =>
      paragraph.bullet !== undefined ||
      paragraph.marginEmu !== undefined ||
      paragraph.indentEmu !== undefined ||
      paragraph.spaceBeforePt !== undefined ||
      paragraph.spaceAfterPt !== undefined,
  );
}

/** Insets of a text box as CSS padding, in `cqw` so they scale with the slide. Absent: none. */
function insetPadding(element: TextElement, size: SlideSize): CSSProperties | null {
  const insets = element.textInsets;
  if (!insets) return null;
  return {
    boxSizing: 'border-box',
    paddingLeft: cqw(emuToCqw(insets.l, size)),
    paddingTop: cqw(emuToCqw(insets.t, size)),
    paddingRight: cqw(emuToCqw(insets.r, size)),
    paddingBottom: cqw(emuToCqw(insets.b, size)),
  };
}

/** Nothing but whitespace in the box. */
function isEmptyText(paragraphs: readonly Paragraph[]): boolean {
  return paragraphs.every((paragraph) => paragraph.runs.every((run) => run.text.trim() === ''));
}

/** A run that states nothing, so the prompt takes the look of the box's type role. */
const PLAIN_RUN: TextRun = {
  text: '',
  font: '',
  sizePt: null,
  bold: null,
  italic: null,
  color: '',
};

/**
 * The prompt set as the text would be: in the first paragraph, with the style of its first run
 * when the empty box keeps one, so it shows where and how big the words will be.
 */
function promptParagraphs(paragraphs: readonly Paragraph[], prompt: string): Paragraph[] {
  const first = paragraphs[0] ?? { level: 0, runs: [], lineSpacing: null };
  return [{ ...first, runs: [{ ...(first.runs[0] ?? PLAIN_RUN), text: prompt }] }];
}

/**
 * The copy, as the IR states it. Nothing is trimmed or rewritten: when the engine has already
 * recorded an overflow, a mark sits on the box and the words stay whole. Text that runs past a
 * box anchored in the middle or at the bottom spills both ways or upwards, as it does in
 * PowerPoint.
 */
export function TextMark({
  element,
  size,
  profile,
  thumbnail = false,
  emptyText,
}: {
  element: TextElement;
  size: SlideSize;
  profile: DesignSystem;
  thumbnail?: boolean;
  /** Prompt for a box with no text; see `SlideViewProps.emptyText`. */
  emptyText?: (element: TextElement) => string | null;
}): JSX.Element {
  const prompt = emptyText && isEmptyText(element.paragraphs) ? emptyText(element) : null;
  const paragraphs = prompt ? promptParagraphs(element.paragraphs, prompt) : element.paragraphs;
  const type = createTypeResolver(profile, size.cy);
  const style = profile.typeScale.find((entry) => entry.role === typeRoleOf(element.role));
  const inherited = paint(profile.palette, style?.colorRole ?? 'text', 'text');
  const lineHeight = lineHeightOf(style?.lineSpacing ?? 1);
  const bulleted = element.role === 'bullet-list';
  const stated = statesParagraphLayout(paragraphs);
  const markPt =
    profile.typeScale.find((entry) => entry.role === 'caption')?.sizePt ??
    profile.typeScale.find((entry) => entry.role === 'footer')?.sizePt ??
    10;

  const lines = paragraphs.map((paragraph, index) => (
    <ParagraphView
      key={index}
      paragraph={paragraph}
      size={size}
      typeSizeEmu={type.sizeEmu(element.role)}
      styleFont={style?.font ?? ''}
      styleBold={style?.bold ?? false}
      styleItalic={style?.italic ?? false}
      styleSizePt={style?.sizePt ?? null}
      inherited={inherited}
      lineHeight={lineHeight}
      bulleted={bulleted}
      stated={stated}
      first={index === 0}
    />
  ));

  return (
    <div
      {...markHooks(element, thumbnail)}
      data-empty-prompt={prompt ? '' : undefined}
      style={{
        ...markStyle(element, size),
        overflow: 'visible',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: ANCHOR[element.verticalAlign ?? 'top'],
        ...insetPadding(element, size),
        ...(prompt
          ? {
              outline: `1px dashed color-mix(in srgb, ${inherited} 45%, transparent)`,
              outlineOffset: -1,
            }
          : null),
      }}
    >
      {prompt ? (
        // Faded as a whole, so a prompt never reads as text somebody wrote.
        <div aria-hidden style={{ opacity: 0.45 }}>
          {lines}
        </div>
      ) : (
        lines
      )}
      {element.overflow && !thumbnail ? (
        <span
          data-overflow="true"
          aria-hidden
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: cqw(ptToCqw(markPt, size)),
            height: cqw(ptToCqw(markPt, size)),
            background: paint(profile.palette, 'negative', 'accent'),
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * One paragraph. When the text states its layout (`stated`), the paragraph sits at its margin, its
 * first line starts at the indent, a bullet hangs in the indent as PowerPoint draws it, and the
 * space before and after is as written. Otherwise levels step in by a fixed amount, a bulleted
 * role gets a dot, and paragraphs keep a small gap.
 */
export function ParagraphView({
  paragraph,
  size,
  typeSizeEmu,
  styleFont,
  styleBold,
  styleItalic,
  styleSizePt,
  inherited,
  lineHeight,
  bulleted,
  stated = false,
  first,
}: {
  paragraph: Paragraph;
  size: SlideSize;
  typeSizeEmu: number;
  styleFont: string;
  styleBold: boolean;
  styleItalic: boolean;
  styleSizePt: number | null;
  inherited: string;
  lineHeight: number;
  bulleted: boolean;
  /** The text states its paragraph layout; see `statesParagraphLayout`. */
  stated?: boolean;
  first: boolean;
}): JSX.Element {
  const lead = paragraph.runs[0];
  const align = paragraph.align ? ALIGN[paragraph.align] : undefined;
  const leadSize = lead?.sizePt ?? styleSizePt ?? (typeSizeEmu > 0 ? typeSizeEmu / EMU_PER_PT : 16);
  const marker = runColor(lead?.color ?? '', inherited);
  const runs = paragraph.runs.map((run, index) => (
    <span
      key={index}
      style={runStyle(
        run,
        size,
        styleFont,
        styleBold,
        styleItalic,
        styleSizePt,
        typeSizeEmu,
        inherited,
      )}
    >
      {showBreaks(run.text)}
    </span>
  ));
  const common: CSSProperties = {
    // A paragraph that states its own spacing wins over the one its type role gives.
    // Both are multiples of single spacing; `lineHeight` is the role's, already as CSS.
    lineHeight: paragraph.lineSpacing != null ? lineHeightOf(paragraph.lineSpacing) : lineHeight,
    fontSize: cqw(ptToCqw(leadSize, size)),
  };

  if (stated) {
    const indent = paragraph.indentEmu ?? 0;
    // PowerPoint leaves out the space before the first paragraph of a box.
    const before = first ? 0 : (paragraph.spaceBeforePt ?? 0);
    const spacing: CSSProperties = {
      margin: 0,
      marginTop: before > 0 ? cqw(ptToCqw(before, size)) : 0,
      marginBottom: paragraph.spaceAfterPt ? cqw(ptToCqw(paragraph.spaceAfterPt, size)) : 0,
      paddingLeft: cqw(emuToCqw(paragraph.marginEmu ?? 0, size)),
    };
    if (!paragraph.bullet) {
      return (
        <div
          style={{
            ...common,
            ...spacing,
            textAlign: align,
            ...(indent !== 0 ? { textIndent: cqw(emuToCqw(indent, size)) } : null),
          }}
        >
          {runs}
        </div>
      );
    }
    // The bullet starts where the first line would, at margin plus indent. A negative indent is
    // the hanging space the bullet sits in, and the text of every line starts at the margin.
    const hanging = indent < 0;
    return (
      <div style={{ ...common, ...spacing, display: 'flex', alignItems: 'baseline' }}>
        <span
          aria-hidden
          data-bullet=""
          style={{
            flex: '0 0 auto',
            marginLeft: cqw(emuToCqw(indent, size)),
            ...(hanging ? { width: cqw(emuToCqw(-indent, size)) } : { paddingRight: '0.5em' }),
            color: marker,
            fontFamily: fontFamily(lead?.font || styleFont),
            whiteSpace: 'pre',
          }}
        >
          {paragraph.bullet}
        </span>
        <span style={{ minWidth: 0, flex: '1 1 0%', textAlign: align }}>{runs}</span>
      </div>
    );
  }

  return (
    <div
      style={{
        ...common,
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.55em',
        margin: 0,
        marginTop: first ? 0 : '0.35em',
        paddingLeft: `${paragraph.level * 1.5}em`,
      }}
    >
      {bulleted ? (
        <span
          aria-hidden
          style={{
            flex: '0 0 auto',
            width: '0.38em',
            height: '0.38em',
            marginTop: '0.48em',
            borderRadius: '50%',
            background: marker,
          }}
        />
      ) : null}
      <span style={{ minWidth: 0, flex: '1 1 0%', textAlign: align }}>{runs}</span>
    </div>
  );
}

function runStyle(
  run: TextRun,
  size: SlideSize,
  styleFont: string,
  styleBold: boolean,
  styleItalic: boolean,
  styleSizePt: number | null,
  typeSizeEmu: number,
  inherited: string,
): CSSProperties {
  const sizePt = run.sizePt ?? styleSizePt ?? (typeSizeEmu > 0 ? typeSizeEmu / EMU_PER_PT : 16);
  const family = fontFamily(run.font || styleFont);
  return {
    fontFamily: family,
    fontSize: cqw(ptToCqw(sizePt, size)),
    fontWeight: (run.bold ?? styleBold) ? 700 : 400,
    fontStyle: (run.italic ?? styleItalic) ? 'italic' : 'normal',
    ...(run.underline ? { textDecoration: 'underline' } : null),
    // Points, like the size, so the tracking scales with the slide exactly as the glyphs do.
    ...(run.letterSpacingPt ? { letterSpacing: cqw(ptToCqw(run.letterSpacingPt, size)) } : null),
    color: runColor(run.color, inherited),
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
  };
}
