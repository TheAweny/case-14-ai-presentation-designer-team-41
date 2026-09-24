import { describe, expect, it } from 'vitest';
import type { DesignSystem, TextRun } from '@lct/contracts';
import type { RangeMarks } from '../active-text-editor';
import {
  leadSizePt,
  rangeLook,
  templateFonts,
  textLook,
  typeSteps,
  type TextElement,
} from './text-model';
import { tokenMeta } from '../../../mocks/demo-deck/token-meta';

const designSystem = {
  typeFamilies: [
    { role: 'primary', font: 'Inter', declared: 'Inter', meta: tokenMeta('theme') },
    { role: 'secondary', font: 'Georgia', declared: 'Georgia', meta: tokenMeta('theme') },
  ],
  palette: [
    { role: 'text', hex: '16181D', meta: tokenMeta('theme') },
    { role: 'accent', hex: '3355DD', meta: tokenMeta('theme') },
  ],
  typeScale: [
    {
      role: 'title',
      font: 'Inter',
      sizePt: 40,
      bold: true,
      italic: false,
      lineSpacing: 1,
      colorRole: 'text',
      meta: tokenMeta('theme'),
    },
    {
      role: 'body',
      font: 'Inter',
      sizePt: 18,
      bold: false,
      italic: false,
      lineSpacing: 1.2,
      colorRole: 'text',
      meta: tokenMeta('theme'),
    },
    {
      role: 'body',
      font: 'Inter',
      sizePt: 18,
      bold: false,
      italic: false,
      lineSpacing: 1.2,
      colorRole: 'text',
      meta: tokenMeta('observed'),
    },
  ],
} as unknown as DesignSystem;

function run(text: string, extra: Partial<TextRun> = {}): TextRun {
  return { text, font: '', sizePt: null, bold: null, italic: null, color: '', ...extra };
}

function text(role: TextElement['role'], runs: TextRun[], extra: object = {}): TextElement {
  return {
    kind: 'text',
    elementId: `${role}-${runs.length}`,
    role,
    box: { x: 0, y: 0, cx: 100, cy: 100 },
    sourceShapeId: null,
    paragraphs: [{ level: 0, runs }],
    overflow: null,
    ...extra,
  } as TextElement;
}

describe('textLook', () => {
  it('takes size, weight and colour from the type role when runs inherit them', () => {
    const look = textLook([text('title', [run('Заголовок')])], designSystem);
    expect(look).toMatchObject({ sizePt: 40, bold: true, italic: false, color: 'text' });
  });

  it('reads a run colour back as its palette role', () => {
    const look = textLook([text('body', [run('a', { color: '3355dd' })])], designSystem);
    expect(look.color).toBe('accent');
  });

  it('reports mixed values as null', () => {
    const look = textLook(
      [text('body', [run('a', { sizePt: 18, bold: true }), run('b', { sizePt: 24 })])],
      designSystem,
    );
    expect(look.sizePt).toBeNull();
    expect(look.bold).toBeNull();
    expect(look.italic).toBe(false);
  });

  it('keeps a colour off the palette as its own hex', () => {
    const look = textLook([text('body', [run('a', { color: 'ff8800' })])], designSystem);
    expect(look.color).toBe('FF8800');
  });

  it('shows the face the text is drawn with: its own or the role one', () => {
    expect(textLook([text('body', [run('a')])], designSystem).font).toBe('Inter');
    const own = textLook([text('body', [run('a', { font: 'Georgia' })])], designSystem);
    expect(own.font).toBe('Georgia');
    const mixed = textLook([text('body', [run('a', { font: 'Georgia' }), run('b')])], designSystem);
    expect(mixed.font).toBeNull();
  });

  it('reads inherited letter spacing as zero and tells it from mixed', () => {
    expect(textLook([text('body', [run('a')])], designSystem).letterSpacingPt).toBe(0);
    const mixed = textLook(
      [text('body', [run('a', { letterSpacingPt: 2 }), run('b')])],
      designSystem,
    );
    expect(mixed.letterSpacingPt).toBeNull();
  });

  it('tells auto line spacing (null) from mixed (undefined)', () => {
    const auto = textLook(
      [
        text('body', [run('a')], {
          paragraphs: [{ level: 0, runs: [run('a')], lineSpacing: null }],
        }),
      ],
      designSystem,
    );
    expect(auto.lineSpacing).toBeNull();
    expect(auto.autoLineSpacing).toBe(1.2);
    const mixed = textLook(
      [
        text('body', [run('a')], {
          paragraphs: [
            { level: 0, runs: [run('a')], lineSpacing: 1.5 },
            { level: 0, runs: [run('b')], lineSpacing: null },
          ],
        }),
      ],
      designSystem,
    );
    expect(mixed.lineSpacing).toBeUndefined();
    const set = textLook(
      [text('body', [], { paragraphs: [{ level: 0, runs: [run('a')], lineSpacing: 1.5 }] })],
      designSystem,
    );
    expect(set.lineSpacing).toBe(1.5);
  });

  it('defaults alignment to left and top', () => {
    const look = textLook([text('body', [run('a')])], designSystem);
    expect(look.align).toBe('left');
    expect(look.verticalAlign).toBe('top');
  });
});

describe('rangeLook', () => {
  const marks: RangeMarks = {
    bold: false,
    boldMode: null,
    italic: false,
    italicMode: null,
    underlineMode: null,
    sizePt: null,
    color: null,
    align: null,
    font: null,
    letterSpacingPt: null,
    lineSpacing: null,
    mixed: [],
  };

  it('falls back to the type role where the fragment states nothing', () => {
    const look = rangeLook(marks, text('title', [run('a')]), designSystem);
    expect(look).toMatchObject({
      sizePt: 40,
      color: 'text',
      font: 'Inter',
      bold: true,
      letterSpacingPt: 0,
      lineSpacing: null,
      autoLineSpacing: 1,
    });
  });

  it('shows what the fragment states, with a hex off the palette as is', () => {
    const look = rangeLook(
      {
        ...marks,
        sizePt: 37,
        color: '#FF8800',
        font: 'Georgia',
        letterSpacingPt: 1.5,
        lineSpacing: 1.5,
      },
      text('body', [run('a')]),
      designSystem,
    );
    expect(look).toMatchObject({
      sizePt: 37,
      color: 'FF8800',
      font: 'Georgia',
      letterSpacingPt: 1.5,
      lineSpacing: 1.5,
    });
  });

  it('reports fields that differ across the selection as mixed', () => {
    const look = rangeLook(
      { ...marks, mixed: ['sizePt', 'color', 'font', 'letterSpacingPt', 'lineSpacing'] },
      text('body', [run('a')]),
      designSystem,
    );
    expect(look.sizePt).toBeNull();
    expect(look.color).toBeNull();
    expect(look.font).toBeNull();
    expect(look.letterSpacingPt).toBeNull();
    expect(look.lineSpacing).toBeUndefined();
  });
});

describe('leadSizePt', () => {
  it('takes the common size, else the first run with words', () => {
    expect(leadSizePt(text('body', [run('a')]), designSystem)).toBe(18);
    const mixed = text('body', [run('', { sizePt: 9 }), run('a', { sizePt: 30 }), run('b')]);
    expect(leadSizePt(mixed, designSystem)).toBe(30);
  });
});

describe('templateFonts', () => {
  it('lists theme families first, each face once', () => {
    expect(templateFonts(designSystem)).toEqual(['Inter', 'Georgia']);
  });
});

describe('typeSteps', () => {
  it('lists each type role once', () => {
    expect(typeSteps(designSystem).map((step) => step.role)).toEqual(['title', 'body']);
  });
});
