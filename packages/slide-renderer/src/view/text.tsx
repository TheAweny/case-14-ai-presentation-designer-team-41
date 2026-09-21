import type { CSSProperties, JSX } from 'react';
import type { DesignSystem, Paragraph, TextRun } from '@lct/contracts';
import { EMU_PER_PT, boxStyle, cqw, ptToCqw, type SlideSize } from '../geometry.js';
import { createTypeResolver, typeRoleOf, type TextElement } from '../schematic/text-layout.js';
import { fontFamily, paint } from './color.js';

function runColor(color: string, fallback: string): string {
  return /^[0-9a-fA-F]{6}$/.test(color) ? `#${color}` : fallback;
}

function showBreaks(text: string): string {
  return text.replaceAll('\v', '\n').replaceAll('\u2028', '\n');
}

/**
 * The copy, as the IR states it. Nothing is trimmed or rewritten: when the engine has already
 * recorded an overflow, a mark sits on the box and the words stay whole.
 */
export function TextMark({
  element,
  size,
  profile,
}: {
  element: TextElement;
  size: SlideSize;
  profile: DesignSystem;
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
      data-kind="text"
      data-role={element.role}
      data-element-id={element.elementId}
      style={{ ...boxStyle(element.box, size), overflow: 'visible' }}
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
      {element.overflow ? (
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

function ParagraphView({
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
        lineHeight,
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
      <span style={{ minWidth: 0 }}>
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
    color: runColor(run.color, inherited),
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
  };
}
