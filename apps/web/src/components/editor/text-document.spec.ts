import { Editor, getSchema } from '@tiptap/core';
import { undo } from '@tiptap/pm/history';
import { Node, type DOMOutputSpec } from '@tiptap/pm/model';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import type { Paragraph } from '@lct/contracts';
import {
  documentToParagraphs,
  htmlParagraphs,
  paragraphsToCommit,
  paragraphsToDoc,
  paragraphStyle,
  pasteText,
  plainParagraphs,
  steppedLevel,
  textExtensions,
  wordAt,
  type HtmlNodeLike,
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
    // 0.9 of single spacing, which PowerPoint sets at 1.2 of the size.
    expect(paragraphStyle(first)).toContain('line-height: 1.08');
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

type Child = HtmlNodeLike | string;

function textNode(value: string): HtmlNodeLike {
  return { nodeType: 3, nodeName: '#text', nodeValue: value, childNodes: [] };
}

/** An element as `DOMParser` gives it, built by hand: the tests run without a DOM. */
function el(tag: string, attrs: Record<string, string>, ...children: Child[]): HtmlNodeLike {
  return {
    nodeType: 1,
    nodeName: tag.toUpperCase(),
    nodeValue: null,
    childNodes: children.map((child) => (typeof child === 'string' ? textNode(child) : child)),
    getAttribute: (name: string) => attrs[name] ?? null,
  };
}

const COMMENT: HtmlNodeLike = {
  nodeType: 8,
  nodeName: '#comment',
  nodeValue: 'StartFragment',
  childNodes: [],
};

describe('pasted text', () => {
  it('makes a paragraph of every plain line and drops one trailing break', () => {
    expect(plainParagraphs('one\r\ntwo\n\nthree\n')).toEqual([
      [{ text: 'one' }],
      [{ text: 'two' }],
      [],
      [{ text: 'three' }],
    ]);
    expect(plainParagraphs('single')).toEqual([[{ text: 'single' }]]);
  });

  it('reads Google Docs HTML: the not-bold wrapper, bold, italic and underline spans', () => {
    const docs = el(
      'body',
      {},
      el(
        'b',
        { style: 'font-weight:normal;', id: 'docs-internal-guid-1' },
        el(
          'p',
          { dir: 'ltr' },
          el('span', { style: 'font-size:11pt;font-weight:700;color:#ff0000' }, 'Жирный'),
          el('span', { style: 'font-size:11pt;font-weight:400' }, ' и '),
          el('span', { style: 'font-style:italic' }, 'курсив'),
        ),
        el('br', {}),
        el('p', {}, el('span', { style: 'text-decoration:underline;' }, 'подчёркнуто')),
      ),
    );
    expect(htmlParagraphs(docs)).toEqual([
      [{ text: 'Жирный', bold: true }, { text: ' и ' }, { text: 'курсив', italic: true }],
      [{ text: 'подчёркнуто', underline: true }],
    ]);
  });

  it('reads Word HTML: skips styles, comments and list markers, collapses whitespace', () => {
    const word = el(
      'html',
      {},
      el('head', {}, el('style', {}, 'p.MsoNormal { margin: 0 }')),
      el(
        'body',
        {},
        COMMENT,
        el(
          'p',
          { class: 'MsoNormal' },
          el('b', {}, el('span', {}, 'Слово\n  жирное')),
          el('span', {}, ' обычное', el('o:p', {})),
        ),
        el(
          'p',
          { class: 'MsoListParagraph' },
          el('span', { style: 'mso-list:Ignore' }, '·', el('span', {}, '  ')),
          el('u', {}, 'Пункт'),
        ),
        el('p', { class: 'MsoNormal' }, el('o:p', {}, ' ')),
      ),
    );
    expect(htmlParagraphs(word)).toEqual([
      [{ text: 'Слово жирное', bold: true }, { text: ' обычное' }],
      [{ text: 'Пункт', underline: true }],
    ]);
  });
});

describe('paste into the open editor', () => {
  const BULLETS: Paragraph[] = [
    {
      level: 1,
      lineSpacing: null,
      runs: [{ text: 'Item', font: 'Deck Face', sizePt: 20, bold: null, italic: null, color: '' }],
    },
  ];

  function openAtEnd(paragraphs: readonly Paragraph[]) {
    const editor = new Editor({
      element: null,
      injectCSS: false,
      enablePasteRules: false,
      extensions: textExtensions({ ...METRICS, bullets: true }),
      content: paragraphsToDoc(paragraphs),
    });
    let state = editor.state.reconfigure({ plugins: editor.extensionManager.plugins });
    state = state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc)));
    const view = {
      get state() {
        return state;
      },
      dispatch(transaction: Transaction) {
        state = state.apply(transaction);
      },
    };
    return { editor, view };
  }

  function clipboard(data: Record<string, string>) {
    let prevented = false;
    return {
      event: {
        clipboardData: { getData: (type: string) => data[type] ?? '' } as DataTransfer,
        preventDefault() {
          prevented = true;
        },
      },
      prevented: () => prevented,
    };
  }

  it('turns three pasted lines into three list items with the caret style', () => {
    const { editor, view } = openAtEnd(BULLETS);
    const paste = clipboard({ 'text/plain': ' one\ntwo\nthree' });
    expect(pasteText(view, paste.event)).toBe(true);
    expect(paste.prevented()).toBe(true);
    const pasted = documentToParagraphs(view.state.doc.toJSON());
    expect(pasted.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual([
      'Item one',
      'two',
      'three',
    ]);
    expect(pasted.every((paragraph) => paragraph.level === 1)).toBe(true);
    expect(
      pasted.every((paragraph) => paragraph.runs.every((run) => run.font === 'Deck Face')),
    ).toBe(true);
    expect(pasted[2]?.runs[0]?.sizePt).toBe(20);

    // One paste is one step of the editor's own history.
    expect(undo(view.state, (transaction) => view.dispatch(transaction))).toBe(true);
    expect(documentToParagraphs(view.state.doc.toJSON())).toEqual(BULLETS);
    editor.destroy();
  });

  it('keeps bold and underline from HTML and the rest from the text being edited', () => {
    const { editor, view } = openAtEnd(BULLETS);
    const paste = clipboard({ 'text/html': '<p>…</p>', 'text/plain': 'plain fallback' });
    const tree = el(
      'body',
      {},
      el('p', {}, ' ', el('strong', { style: 'color: red' }, 'B'), el('u', {}, 'U')),
    );
    expect(pasteText(view, paste.event, () => tree)).toBe(true);
    const [paragraph] = documentToParagraphs(view.state.doc.toJSON());
    expect(paragraph?.runs).toEqual([
      { text: 'Item', font: 'Deck Face', sizePt: 20, bold: null, italic: null, color: '' },
      { text: 'B', font: 'Deck Face', sizePt: 20, bold: true, italic: null, color: '' },
      {
        text: 'U',
        font: 'Deck Face',
        sizePt: 20,
        bold: null,
        italic: null,
        color: '',
        underline: true,
      },
    ]);
    editor.destroy();
  });

  it('falls back to plain text when the HTML has no text, and leaves files alone', () => {
    const { editor, view } = openAtEnd(BULLETS);
    const paste = clipboard({ 'text/html': '<img>', 'text/plain': '!' });
    expect(pasteText(view, paste.event, () => el('body', {}, el('img', {})))).toBe(true);
    expect(documentToParagraphs(view.state.doc.toJSON())[0]?.runs[0]?.text).toBe('Item!');

    const files = clipboard({});
    expect(pasteText(view, files.event)).toBe(false);
    expect(files.prevented()).toBe(false);
    editor.destroy();
  });
});

describe('words and levels', () => {
  it('finds the word under the caret, joined words included', () => {
    const text = 'Смотри из-за угла, v2 don’t';
    expect(wordAt(text, 0)).toEqual([0, 6]);
    expect(wordAt(text, 3)).toEqual([0, 6]);
    // Right after a word still names it.
    expect(wordAt(text, 6)).toEqual([0, 6]);
    expect(wordAt(text, 8)).toEqual([7, 12]);
    expect(wordAt(text, 19)).toEqual([19, 21]);
    expect(wordAt(text, text.length)).toEqual([22, 27]);
    expect(wordAt(', ', 1)).toBeNull();
    expect(wordAt('', 0)).toBeNull();
  });

  it('counts offsets in UTF-16 units, as ProseMirror does', () => {
    // «𝔸» is two units long.
    expect(wordAt('𝔸b c', 1)).toEqual([0, 3]);
  });

  it('steps paragraph levels within 0…8', () => {
    expect(steppedLevel(0, 1)).toBe(1);
    expect(steppedLevel(0, -1)).toBe(0);
    expect(steppedLevel(8, 1)).toBe(8);
    expect(steppedLevel('2', -1)).toBe(1);
  });
});

describe('paragraph style in the open editor', () => {
  it('follows the size of the first run, so spacing matches the slide after a resize', () => {
    const schema = getSchema(textExtensions(METRICS));
    const run = { text: 'Крупно', font: '', sizePt: null, bold: null, italic: null, color: '' };
    const doc = Node.fromJSON(
      schema,
      paragraphsToDoc([{ level: 1, lineSpacing: null, runs: [run] }]),
    );
    const paragraph = doc.firstChild;
    const mark = schema.marks.textStyle?.create({ fontSize: '32' });
    if (!paragraph || !mark) throw new Error('schema without paragraphs or text style');
    const inherited = paragraphStyle(paragraph, METRICS);
    expect(inherited).toContain('padding-left: 1.5em');

    const larger = paragraph.type.create(paragraph.attrs, schema.text('Крупно', [mark]));
    const resized = paragraphStyle(larger, METRICS);
    expect(resized).not.toBe(inherited);
    expect(resized).toContain('padding-left: 1.5em');
  });
});

describe('paragraph layout read from the file survives the editor', () => {
  const run = { text: 'Ключевые факты', font: '', sizePt: 16, bold: null, italic: null, color: '' };
  const STATED: Paragraph[] = [
    {
      level: 0,
      lineSpacing: null,
      runs: [run],
      bullet: '•',
      marginEmu: 228_600,
      indentEmu: -228_600,
      spaceBeforePt: 6,
      spaceAfterPt: 3,
    },
    { level: 0, lineSpacing: null, runs: [{ ...run, text: 'Со сдвигом' }], indentEmu: 127_000 },
    { level: 1, lineSpacing: null, runs: [{ ...run, text: 'Как было' }] },
  ];

  it('gives back the bullet, margin, indent and spacing each paragraph came with', () => {
    expect(throughSchema(STATED)).toEqual(STATED);
  });

  it('draws the paragraph at its margin with its own bullet in the indent', () => {
    const schema = getSchema(textExtensions({ ...METRICS, bullets: true }));
    const doc = Node.fromJSON(schema, paragraphsToDoc(STATED));
    const spec = (index: number) => schema.nodes.paragraph?.spec.toDOM?.(doc.child(index));
    const attrsOf = (index: number): unknown => {
      const output = spec(index);
      return Array.isArray(output) ? output[1] : null;
    };

    // 1 pt on a 100 pt wide slide is 1 cqw: an 18 pt margin, the bullet hanging at its left.
    const bulleted = styleIn(spec(0));
    expect(bulleted).toContain('padding-left: 18cqw');
    expect(bulleted).toContain('--bullet-x: 0cqw');
    expect(bulleted).toContain('margin-top: 6cqw');
    expect(bulleted).toContain('margin-bottom: 3cqw');
    expect(attrsOf(0)).toMatchObject({ 'data-stated': '', 'data-bullet': '•' });

    const indented = styleIn(spec(1));
    expect(indented).toContain('text-indent: 10cqw');
    expect(indented).not.toContain('--bullet-x');
    expect(attrsOf(1)).toHaveProperty('data-stated');
    expect(attrsOf(1)).not.toHaveProperty('data-bullet');

    // A paragraph that states no layout keeps the editor's own step and role bullet.
    const plain = styleIn(spec(2));
    expect(plain).toContain('padding-left: 2.65em');
    expect(plain).not.toContain('margin-top');
    expect(attrsOf(2)).not.toHaveProperty('data-stated');
  });
});
