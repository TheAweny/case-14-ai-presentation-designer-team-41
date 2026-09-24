import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { DesignSystem, Paragraph, SlideIr, TextRun } from '@lct/contracts';
import { commitElementProps } from '@lct/deck-ops';
import type { TextElement } from './inspector/text-model';
import { documentToParagraphs, paragraphsToDoc, textExtensions } from './text-document';
import {
  flagProps,
  rangeFlagOn,
  runTextCommand,
  sizeEntries,
  sizeLadder,
  stepFontSize,
  toggleRangeFlag,
} from './text-shortcuts';
import { tokenMeta } from '../../mocks/demo-deck/token-meta';

function style(role: string, sizePt: number, bold: boolean) {
  return {
    role,
    font: 'Inter',
    sizePt,
    bold,
    italic: false,
    lineSpacing: 1,
    colorRole: 'text',
    meta: tokenMeta('theme'),
  };
}

const designSystem = {
  typeFamilies: [],
  palette: [{ role: 'text', hex: '16181D', meta: tokenMeta('theme') }],
  typeScale: [
    style('title', 40, true),
    style('subtitle', 24, false),
    style('body', 18, false),
    style('body', 18, false),
    style('footer', 12, false),
  ],
} as unknown as DesignSystem;

function run(text: string, extra: Partial<TextRun> = {}): TextRun {
  return { text, font: '', sizePt: null, bold: null, italic: null, color: '', ...extra };
}

function text(elementId: string, role: TextElement['role'], runs: TextRun[]): TextElement {
  return {
    kind: 'text',
    elementId,
    role,
    box: { x: 0, y: 0, cx: 100, cy: 100 },
    sourceShapeId: null,
    paragraphs: [{ level: 0, runs, lineSpacing: null }],
    overflow: null,
  } as TextElement;
}

describe('stepFontSize', () => {
  const ladder = sizeLadder(designSystem);

  it('reads the template scale once per size, smallest first', () => {
    expect(ladder).toEqual([12, 18, 24, 40]);
  });

  it('goes to the next step of the scale, from any size', () => {
    expect(stepFontSize(18, ladder, 1)).toBe(24);
    expect(stepFontSize(20, ladder, 1)).toBe(24);
    expect(stepFontSize(20, ladder, -1)).toBe(18);
    expect(stepFontSize(12, ladder, -1)).toBeLessThan(12);
  });

  it('keeps going past the ends of the scale by a tenth, at least a point', () => {
    expect(stepFontSize(40, ladder, 1)).toBe(44);
    expect(stepFontSize(12, ladder, -1)).toBe(11);
    expect(stepFontSize(1, [], -1)).toBe(1);
  });
});

describe('Ctrl+B/I/U on whole text objects', () => {
  it('sets a flag unless every run already has it, counting the role', () => {
    const plain = text('body', 'body', [run('a'), run('b')]);
    const half = text('mixed', 'body', [run('a', { bold: true }), run('b')]);
    const title = text('title', 'title', [run('Heading')]);
    expect(flagProps([plain], 'bold', designSystem)).toEqual({ bold: true });
    expect(flagProps([half], 'bold', designSystem)).toEqual({ bold: true });
    // Заголовок жирный от роли: первое нажатие делает его обычным.
    expect(flagProps([title], 'bold', designSystem)).toEqual({ bold: false });
    expect(flagProps([title, plain], 'bold', designSystem)).toEqual({ bold: true });
    expect(flagProps([plain], 'italic', designSystem)).toEqual({ italic: true });
  });

  it('underlines unless everything is underlined', () => {
    const under = text('u', 'body', [run('a', { underline: true })]);
    const some = text('s', 'body', [run('a', { underline: true }), run('b')]);
    expect(flagProps([under], 'underline', designSystem)).toEqual({ underline: false });
    expect(flagProps([some], 'underline', designSystem)).toEqual({ underline: true });
  });

  it('toggles the runs of every selected text as one change, and back', () => {
    const slide = {
      slideId: 's1',
      elements: [
        text('a', 'body', [run('one'), run('two', { bold: true })]),
        text('b', 'body', [run('three')]),
      ],
    } as unknown as SlideIr;
    const runsOf = (slides: readonly SlideIr[]) =>
      slides[0]?.elements.flatMap((element) =>
        element.kind === 'text' ? element.paragraphs.flatMap((paragraph) => paragraph.runs) : [],
      ) ?? [];
    const texts = slide.elements as TextElement[];
    const on = commitElementProps([slide], {
      slideId: 's1',
      elementIds: ['a', 'b'],
      props: flagProps(texts, 'bold', designSystem),
    });
    expect(on.change).not.toBeNull();
    expect(runsOf(on.slides).every((item) => item.bold === true)).toBe(true);
    const bolded = on.slides[0]?.elements as TextElement[];
    const off = commitElementProps(on.slides, {
      slideId: 's1',
      elementIds: ['a', 'b'],
      props: flagProps(bolded, 'bold', designSystem),
    });
    expect(runsOf(off.slides).every((item) => item.bold === false)).toBe(true);
  });

  it('steps each text from its own size', () => {
    const small = text('small', 'footer', [run('a')]);
    const own = text('own', 'body', [run('a', { sizePt: 30 })]);
    expect(sizeEntries([small, own], designSystem, 1)).toEqual([
      { elementId: 'small', sizePt: 18 },
      { elementId: 'own', sizePt: 40 },
    ]);
  });
});

const SLIDE = { cx: 1_270_000, cy: 1_270_000 };
const editors: Editor[] = [];

function open(paragraphs: Paragraph[]): Editor {
  const editor = new Editor({
    element: null,
    injectCSS: false,
    enablePasteRules: false,
    extensions: textExtensions({ slide: SLIDE, inheritedSizePt: 18, bullets: false }),
    content: paragraphsToDoc(paragraphs),
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

const BODY = { bold: false, italic: false, sizePt: 18 };
const TITLE = { bold: true, italic: false, sizePt: 40 };

function runs(editor: Editor): TextRun[] {
  return documentToParagraphs(editor.getJSON()).flatMap((paragraph) => paragraph.runs);
}

describe('Ctrl+B/I/U inside the open editor', () => {
  it('underlines the selected word only, and the runs keep it', () => {
    const editor = open([{ level: 0, lineSpacing: null, runs: [run('Hello world')] }]);
    editor.commands.setTextSelection({ from: 7, to: 12 });
    toggleRangeFlag(editor, 'underline', BODY);
    expect(runs(editor)).toEqual([run('Hello '), run('world', { underline: true })]);
    toggleRangeFlag(editor, 'underline', BODY);
    expect(runs(editor).find((item) => item.text === 'world')?.underline).toBe(false);
  });

  it('bolds a partly bold selection first, then takes bold off', () => {
    const editor = open([
      { level: 0, lineSpacing: null, runs: [run('ab', { bold: true }), run('cd')] },
    ]);
    editor.commands.setTextSelection({ from: 1, to: 5 });
    expect(rangeFlagOn(editor, 'bold', BODY)).toBe(false);
    toggleRangeFlag(editor, 'bold', BODY);
    expect(runs(editor)).toEqual([run('abcd', { bold: true })]);
    toggleRangeFlag(editor, 'bold', BODY);
    expect(runs(editor)).toEqual([run('abcd', { bold: false })]);
  });

  it('counts the role: a bold title word goes regular on the first press', () => {
    const editor = open([{ level: 0, lineSpacing: null, runs: [run('Title')] }]);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    expect(rangeFlagOn(editor, 'bold', TITLE)).toBe(true);
    toggleRangeFlag(editor, 'bold', TITLE);
    expect(runs(editor)).toEqual([run('Title', { bold: false })]);
  });

  it('runs alignment and size commands and leaves the rest to the editor', () => {
    const editor = open([{ level: 0, lineSpacing: null, runs: [run('Hello')] }]);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    const ladder = sizeLadder(designSystem);
    expect(runTextCommand(editor, { kind: 'text-align', align: 'center' }, BODY, ladder)).toBe(
      true,
    );
    expect(runTextCommand(editor, { kind: 'text-size', step: 1 }, BODY, ladder)).toBe(true);
    expect(runTextCommand(editor, { kind: 'undo' }, BODY, ladder)).toBe(false);
    const [paragraph] = documentToParagraphs(editor.getJSON());
    expect(paragraph?.align).toBe('center');
    expect(paragraph?.runs).toEqual([run('Hello', { sizePt: 24 })]);
  });
});
