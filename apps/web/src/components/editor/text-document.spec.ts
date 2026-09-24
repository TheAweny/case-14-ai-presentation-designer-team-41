import { Editor, getSchema } from '@tiptap/core';
import { undo } from '@tiptap/pm/history';
import { Node } from '@tiptap/pm/model';
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
