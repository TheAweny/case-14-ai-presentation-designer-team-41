import type { CSSProperties, JSX } from 'react';
import type {
  DesignSystem,
  Paragraph,
  ParagraphAlign,
  TextRun,
  VerticalAlign,
} from '@lct/contracts';
import { EMU_PER_PT, cqw, ptToCqw, type SlideSize } from '../geometry.js';
import { createTypeResolver, typeRoleOf, type TextElement } from '../schematic/text-layout.js';
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
}: {
  element: TextElement;
  size: SlideSize;
  profile: DesignSystem;
  thumbnail?: boolean;
}): JSX.Element {
  const type = createTypeResolver(profile, size.cy);
  const style = profile.typeScale.find((entry) => entry.role === typeRoleOf(element.role));
  const inherited = paint(profile.palette, style?.colorRole ?? 'text', 'text');
  const lineHeight = style?.lineSpacing ?? 1.2;
  const bulleted = element.role === 'bullet-list';
  const markPt =
    profile.typeScale.find((entry) => entry.role === 'caption')?.sizePt ??
    profile.typeScale.find((entry) => entry.role === 'footer')?.sizePt ??
    10;

  return (
    <div
      {...markHooks(element, thumbnail)}
      style={{
        ...markStyle(element, size),
        overflow: 'visible',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: ANCHOR[element.verticalAlign ?? 'top'],
      }}
    >
      {element.paragraphs.map((paragraph, index) => (
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
          first={index === 0}
        />
      ))}
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
  first: boolean;
}): JSX.Element {
  const lead = paragraph.runs[0];
  const align = paragraph.align ? ALIGN[paragraph.align] : undefined;
  const leadSize = lead?.sizePt ?? styleSizePt ?? (typeSizeEmu > 0 ? typeSizeEmu / EMU_PER_PT : 16);
  const marker = runColor(lead?.color ?? '', inherited);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.55em',
        margin: 0,
        marginTop: first ? 0 : '0.35em',
        paddingLeft: `${paragraph.level * 1.5}em`,
        // A paragraph that states its own spacing wins over the one its type role gives.
        lineHeight: paragraph.lineSpacing ?? lineHeight,
        fontSize: cqw(ptToCqw(leadSize, size)),
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
      <span style={{ minWidth: 0, flex: '1 1 0%', textAlign: align }}>
        {paragraph.runs.map((run, index) => (
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
        ))}
      </span>
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
