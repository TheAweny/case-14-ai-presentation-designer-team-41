import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { Paragraph, TextRun } from '@lct/contracts';
import {
  KEEPS_TEXT_FOCUS,
  rangeMarks,
  setParagraphAlign,
  setParagraphLineSpacing,
  setRangeColor,
  setRangeFont,
  setRangeLetterSpacing,
  setRangeSize,
  setRunFlag,
} from './active-text-editor';
import { documentToParagraphs, paragraphsToDoc, textExtensions } from './text-document';

const SLIDE = { cx: 1_270_000, cy: 1_270_000 };
const METRICS = { slide: SLIDE, inheritedSizePt: 16, bullets: false };

function run(text: string, extra: Partial<TextRun> = {}): TextRun {
  return { text, font: '', sizePt: null, bold: null, italic: null, color: '', ...extra };
}

const editors: Editor[] = [];

function open(paragraphs: Paragraph[]): Editor {
  const editor = new Editor({
    element: null,
    injectCSS: false,
    enablePasteRules: false,
    extensions: textExtensions(METRICS),
    content: paragraphsToDoc(paragraphs),
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

/** Positions inside the first paragraph: the document starts with its opening token at 0. */
function select(editor: Editor, from: number, to: number) {
  editor.commands.setTextSelection({ from, to });
}

function paragraphs(editor: Editor): Paragraph[] {
  return documentToParagraphs(editor.getJSON());
}

const TWO_WORDS: Paragraph[] = [
  { level: 0, lineSpacing: null, runs: [run('Hello world')] },
  { level: 0, lineSpacing: null, runs: [run('second')] },
];

describe('range setters in the open editor', () => {
  it('sets any positive size, not only a type-scale step, and null inherits again', () => {
    const editor = open(TWO_WORDS);
    select(editor, 1, 6);
    setRangeSize(editor, 13.5);
    expect(paragraphs(editor)[0]?.runs[0]).toMatchObject({ text: 'Hello', sizePt: 13.5 });
    setRangeSize(editor, 0);
    setRangeSize(editor, Number.NaN);
    expect(paragraphs(editor)[0]?.runs[0]?.sizePt).toBe(13.5);
    setRangeSize(editor, null);
    expect(paragraphs(editor)[0]?.runs).toStrictEqual([run('Hello world')]);
  });

  it('takes any hex colour in short or long form, with or without a hash', () => {
    const editor = open(TWO_WORDS);
    select(editor, 1, 6);
    setRangeColor(editor, '#a1b');
    expect(paragraphs(editor)[0]?.runs[0]).toMatchObject({ text: 'Hello', color: 'AA11BB' });
    setRangeColor(editor, '12ab3c');
    expect(paragraphs(editor)[0]?.runs[0]?.color).toBe('12AB3C');
    setRangeColor(editor, 'accent');
    expect(paragraphs(editor)[0]?.runs[0]?.color).toBe('12AB3C');
    setRangeColor(editor, null);
    expect(paragraphs(editor)[0]?.runs).toStrictEqual([run('Hello world')]);
  });

  it('sets a font family by name, and null or an empty name inherits again', () => {
    const editor = open(TWO_WORDS);
    select(editor, 7, 12);
    setRangeFont(editor, 'Open Sans');
    expect(paragraphs(editor)[0]?.runs).toStrictEqual([
      run('Hello '),
      run('world', { font: 'Open Sans' }),
    ]);
    expect(rangeMarks(editor).font).toBe('Open Sans');
    setRangeFont(editor, '');
    expect(paragraphs(editor)[0]?.runs).toStrictEqual([run('Hello world')]);
    setRangeFont(editor, 'Open Sans');
    setRangeFont(editor, null);
    expect(paragraphs(editor)[0]?.runs).toStrictEqual([run('Hello world')]);
  });

  it('sets letter spacing in points, zero and negative included, and null inherits', () => {
    const editor = open(TWO_WORDS);
    select(editor, 1, 6);
    setRangeLetterSpacing(editor, -0.5);
    expect(paragraphs(editor)[0]?.runs[0]).toStrictEqual(run('Hello', { letterSpacingPt: -0.5 }));
    expect(rangeMarks(editor).letterSpacingPt).toBe(-0.5);
    setRangeLetterSpacing(editor, 0);
    expect(paragraphs(editor)[0]?.runs[0]).toStrictEqual(run('Hello', { letterSpacingPt: 0 }));
    setRangeLetterSpacing(editor, Number.POSITIVE_INFINITY);
    expect(paragraphs(editor)[0]?.runs[0]?.letterSpacingPt).toBe(0);
    setRangeLetterSpacing(editor, null);
    expect(paragraphs(editor)[0]?.runs).toStrictEqual([run('Hello world')]);
  });

  it('sets line spacing on every paragraph the selection touches', () => {
    const editor = open(TWO_WORDS);
    select(editor, 3, 16);
    setParagraphLineSpacing(editor, 1.5);
    expect(paragraphs(editor).map((paragraph) => paragraph.lineSpacing)).toEqual([1.5, 1.5]);
    expect(rangeMarks(editor).lineSpacing).toBe(1.5);
    setParagraphLineSpacing(editor, -1);
    expect(paragraphs(editor).map((paragraph) => paragraph.lineSpacing)).toEqual([1.5, 1.5]);
    select(editor, 3, 3);
    setParagraphLineSpacing(editor, null);
    expect(paragraphs(editor).map((paragraph) => paragraph.lineSpacing)).toEqual([null, 1.5]);
  });

  it('keeps alignment and flags working through the same chain', () => {
    const editor = open(TWO_WORDS);
    select(editor, 1, 6);
    setRunFlag(editor, 'bold', true);
    setParagraphAlign(editor, 'center');
    const [first] = paragraphs(editor);
    expect(first?.align).toBe('center');
    expect(first?.runs[0]).toMatchObject({ text: 'Hello', bold: true });
  });
});

describe('range marks', () => {
  const STYLED: Paragraph[] = [
    {
      level: 0,
      lineSpacing: 1.2,
      runs: [
        run('Hello ', { font: 'Deck Face', sizePt: 24, color: 'AABBCC', letterSpacingPt: 1 }),
        run('world', { font: 'Other Face', sizePt: 24, color: 'AABBCC', letterSpacingPt: 2 }),
      ],
    },
    { level: 0, lineSpacing: 1.5, runs: [run('second', { sizePt: 24 })] },
  ];

  it('reads the values under the caret', () => {
    const editor = open(STYLED);
    select(editor, 3, 3);
    const marks = rangeMarks(editor);
    expect(marks).toMatchObject({
      sizePt: 24,
      color: '#AABBCC',
      font: 'Deck Face',
      letterSpacingPt: 1,
      lineSpacing: 1.2,
      mixed: [],
    });
  });

  it('gives null and names the field when the selection disagrees', () => {
    const editor = open(STYLED);
    select(editor, 1, 12);
    const inOneParagraph = rangeMarks(editor);
    expect(inOneParagraph).toMatchObject({
      sizePt: 24,
      color: '#AABBCC',
      font: null,
      letterSpacingPt: null,
      lineSpacing: 1.2,
    });
    expect([...inOneParagraph.mixed].sort()).toEqual(['font', 'letterSpacingPt']);

    select(editor, 1, 18);
    const across = rangeMarks(editor);
    expect(across.sizePt).toBe(24);
    expect(across.color).toBeNull();
    expect(across.lineSpacing).toBeNull();
    expect([...across.mixed].sort()).toEqual(['color', 'font', 'letterSpacingPt', 'lineSpacing']);
  });

  it('reports nothing stated as null without calling it mixed', () => {
    const editor = open(TWO_WORDS);
    select(editor, 1, 12);
    expect(rangeMarks(editor)).toMatchObject({
      sizePt: null,
      color: null,
      font: null,
      letterSpacingPt: null,
      lineSpacing: null,
      mixed: [],
    });
  });
});

describe('focus kept while the text is open', () => {
  it('counts the inspector popovers as part of the text controls', () => {
    expect(KEEPS_TEXT_FOCUS).toContain('[data-inspector-popover]');
  });
});
