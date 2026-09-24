import { Editor, getSchema } from '@tiptap/core';
import { undo } from '@tiptap/pm/history';
import { Node, type DOMOutputSpec } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import type { Paragraph } from '@lct/contracts';
import {
  documentToParagraphs,
  paragraphsToCommit,
  paragraphsToDoc,
  pasteAsPlainText,
  textExtensions,
} from './text-document';

const SLIDE = { cx: 1_270_000, cy: 1_270_000 };
const METRICS = { slide: SLIDE, inheritedSizePt: 16, bullets: false };

const RICH: Paragraph[] = [
  {
    level: 0,
    lineSpacing: null,
    runs: [
      {
        text: 'Hello ',
        font: 'Deck Face',
        sizePt: 32,
        bold: true,
        italic: false,
        color: '16181D',
      },
      {
        text: 'world',
        font: '',
        sizePt: null,
        bold: null,
        italic: true,
        color: '',
      },
    ],
  },
  {
    level: 2,
    lineSpacing: 1.5,
    runs: [
      {
        text: 'line\nbreak',
        font: 'Deck Face',
        sizePt: 16,
        bold: false,
        italic: null,
        color: 'AABBCC',
      },
    ],
  },
];

function throughSchema(paragraphs: readonly Paragraph[]): Paragraph[] {
  const schema = getSchema(textExtensions(METRICS));
  const doc = Node.fromJSON(schema, paragraphsToDoc(paragraphs));
  return documentToParagraphs(doc.toJSON());
}

describe('text document', () => {
  it('keeps bold, italic, font, size, colour, level and line spacing through the schema', () => {
    expect(throughSchema(RICH)).toEqual(RICH);
  });

  it('merges adjacent runs that carry the same marks', () => {
    const [paragraph] = throughSchema([
      {
        level: 0,
        lineSpacing: null,
        runs: [
          { text: 'one', font: 'Deck Face', sizePt: 16, bold: true, italic: null, color: '' },
          { text: 'two', font: 'Deck Face', sizePt: 16, bold: true, italic: null, color: '' },
        ],
      },
    ]);
    expect(paragraph?.runs).toEqual([
      { text: 'onetwo', font: 'Deck Face', sizePt: 16, bold: true, italic: null, color: '' },
    ]);
  });

  it('shows a vertical tab as a line break inside the editor', () => {
    const doc = paragraphsToDoc([
      {
        level: 0,
        lineSpacing: null,
        runs: [{ text: 'a\vb', font: '', sizePt: null, bold: null, italic: null, color: '' }],
      },
    ]);
    const text = doc.content?.[0]?.content?.[0]?.text;
    expect(text).toBe('a\nb');
  });

  it('does not commit when the editor document is untouched', () => {
    const schema = getSchema(textExtensions(METRICS));
    const baseline = Node.fromJSON(schema, paragraphsToDoc(RICH)).toJSON();
    expect(paragraphsToCommit(baseline, baseline)).toBeNull();
  });

  it('pastes plain text and drops HTML formatting', () => {
    let inserted = '';
    let prevented = false;
    const handled = pasteAsPlainText(
      {
        state: {
          tr: {
            insertText(text: string) {
              inserted = text;
              return this;
            },
          },
        },
        dispatch(step: unknown) {
          void step;
        },
      },
      {
        clipboardData: {
          getData: (type: string) => (type === 'text/plain' ? 'plain' : '<b>html</b>'),
        },
        preventDefault() {
          prevented = true;
        },
      } as ClipboardEvent,
    );
    expect(handled).toBe(true);
    expect(prevented).toBe(true);
    expect(inserted).toBe('plain');
  });

  it('keeps the new character in the run marks, and history undoes that one step', () => {
    const editor = new Editor({
      element: null,
      injectCSS: false,
      enablePasteRules: false,
      extensions: textExtensions(METRICS),
      content: paragraphsToDoc(RICH),
    });
    let state = editor.state.reconfigure({ plugins: editor.extensionManager.plugins });
    const baseline = state.doc.toJSON();
    const dispatch = (transaction: Transaction) => {
      state = state.apply(transaction);
    };
    dispatch(state.tr.insertText('X'));
    const edited = documentToParagraphs(state.doc.toJSON());
    expect(edited[0]?.runs.map((run) => run.text).join('')).toContain('X');
    expect(edited[0]?.runs.some((run) => run.bold === true && run.text.includes('X'))).toBe(true);
    expect(paragraphsToCommit(baseline, state.doc.toJSON())).toEqual(edited);

    expect(undo(state, dispatch)).toBe(true);
    expect(paragraphsToCommit(baseline, state.doc.toJSON())).toBeNull();
    editor.destroy();
  });
});

describe('alignment and underline survive the editor', () => {
  it('keeps paragraph alignment and run underline through the schema', () => {
    const styled: Paragraph[] = [
      {
        level: 0,
        lineSpacing: null,
        align: 'center',
        runs: [
          {
            text: 'Под',
            font: '',
            sizePt: null,
            bold: null,
            italic: null,
            color: '',
            underline: true,
          },
          { text: 'чёркнуто', font: '', sizePt: null, bold: null, italic: null, color: '' },
        ],
      },
      {
        level: 0,
        lineSpacing: null,
        runs: [{ text: 'слева', font: '', sizePt: null, bold: null, italic: null, color: '' }],
      },
    ];
    expect(throughSchema(styled)).toEqual(styled);
  });
});

/** The inline style of a rendered node or mark, read from its DOM spec without a DOM. */
function styleIn(spec: DOMOutputSpec | undefined): string {
  if (!Array.isArray(spec)) return '';
  const attrs: unknown = spec[1];
  if (typeof attrs !== 'object' || attrs === null || !('style' in attrs)) return '';
  return String(attrs.style);
}

describe('font, letter spacing and line spacing survive the editor', () => {
  const EXACT: Paragraph[] = [
    {
      level: 0,
      lineSpacing: 0.9,
      align: null,
      runs: [
        {
          text: 'Узко ',
          font: 'Deck Face',
          sizePt: 40,
          bold: null,
          italic: null,
          color: '',
          letterSpacingPt: -1.5,
        },
        {
          text: 'ноль ',
          font: '',
          sizePt: null,
          bold: null,
          italic: null,
          color: '',
          letterSpacingPt: 0,
          underline: null,
        },
        {
          text: 'от роли ',
          font: '',
          sizePt: null,
          bold: null,
          italic: null,
          color: 'AABBCC',
          letterSpacingPt: null,
        },
        {
          text: 'без ключа',
          font: 'Other Face',
          sizePt: 12.5,
          bold: false,
          italic: true,
          color: '',
        },
      ],
    },
    {
      level: 1,
      lineSpacing: null,
      runs: [
        {
          text: 'разрядка',
          font: 'Deck Face',
          sizePt: null,
          bold: true,
          italic: false,
          color: '',
          underline: false,
          letterSpacingPt: 3.25,
        },
      ],
    },
  ];

  it('gives back the same runs and paragraphs, null and absent keys included', () => {
    expect(throughSchema(EXACT)).toStrictEqual(EXACT);
  });

  it('merges runs whose letter spacing is inherited either way, and keeps different ones apart', () => {
    const [paragraph] = throughSchema([
      {
        level: 0,
        lineSpacing: null,
        runs: [
          { text: 'a', font: '', sizePt: null, bold: null, italic: null, color: '' },
          {
            text: 'b',
            font: '',
            sizePt: null,
            bold: null,
            italic: null,
            color: '',
            letterSpacingPt: null,
          },
          {
            text: 'c',
            font: '',
            sizePt: null,
            bold: null,
            italic: null,
            color: '',
            letterSpacingPt: 1,
          },
        ],
      },
    ]);
    expect(paragraph?.runs.map((run) => run.text)).toEqual(['ab', 'c']);
  });

  it('paints letter spacing in cqw like the size, and paragraph line spacing as line-height', () => {
    const schema = getSchema(textExtensions(METRICS));
    const doc = Node.fromJSON(schema, paragraphsToDoc(EXACT));
    const first = doc.child(0);
    const second = doc.child(1);

    const paragraphStyle = (node: typeof first) =>
      styleIn(schema.nodes.paragraph?.spec.toDOM?.(node));
    expect(paragraphStyle(first)).toContain('line-height: 0.9');
    expect(paragraphStyle(second)).not.toContain('line-height');

    const styleOf = (index: number) => {
      const mark = first.child(index).marks.find((item) => item.type.name === 'textStyle');
      return mark ? styleIn(schema.marks.textStyle?.spec.toDOM?.(mark, true)) : '';
    };
    // 1 pt on a 100 pt wide slide (1 270 000 EMU) is 1 cqw, as for the size.
    expect(styleOf(0)).toContain('letter-spacing: -1.5cqw');
    expect(styleOf(0)).toContain('font-size: 40cqw');
    expect(styleOf(0)).toContain('font-family: "Deck Face"');
    expect(styleOf(1)).toContain('letter-spacing: 0cqw');
    expect(styleOf(2)).not.toContain('letter-spacing');
  });
});
