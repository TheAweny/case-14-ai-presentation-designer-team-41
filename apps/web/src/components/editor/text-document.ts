import type { Paragraph, ParagraphAlign, TextRun } from '@lct/contracts';
import type { Extensions, JSONContent } from '@tiptap/core';
import { Extension, mergeAttributes } from '@tiptap/core';
import { Bold } from '@tiptap/extension-bold';
import { Color } from '@tiptap/extension-color';
import { Document } from '@tiptap/extension-document';
import { FontFamily } from '@tiptap/extension-font-family';
import { History } from '@tiptap/extension-history';
import { Italic } from '@tiptap/extension-italic';
import { Paragraph as ParagraphNode } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';
import { FontSize, TextStyle } from '@tiptap/extension-text-style';
import { Fragment, Slice, type Mark, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { cqw, fontFamily, ptToCqw, type SlideSize } from '@lct/slide-renderer';

/**
 * What the open editor needs from the slide, besides the runs themselves.
 * Font size is stored in points and painted in `cqw`, so it tracks the frame.
 */
export interface TextEditorMetrics {
  readonly slide: SlideSize;
  /** Type-scale size, used when a run does not name its own. */
  readonly inheritedSizePt: number;
  readonly bullets: boolean;
}

const MODE_TRUE = 'true';
const MODE_FALSE = 'false';
/**
 * An optional field (run underline and letter spacing, paragraph alignment) stated as null. The
 * contract lets it be null or absent, both meaning "inherit"; the editor keeps which one it was,
 * so the runs come back exactly as they went in.
 */
const INHERIT = 'inherit';

/** Vertical tab and the Unicode line separator are line breaks on the slide. */
function editorText(text: string): string {
  return text.replaceAll('\v', '\n').replaceAll('\u2028', '\n');
}

function levelOf(value: unknown): number {
  const level = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(level) || level <= 0) return 0;
  return Math.floor(level);
}

export function sizeOf(value: unknown): number | null {
  const points =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(points) && points > 0 ? points : null;
}

/**
 * Letter spacing in points, or null when the run does not state it. Zero and negative
 * (condensed) spacing are real values. Stored as a string, like the size, so an empty text
 * style check does not drop a zero.
 */
export function letterSpacingOf(value: unknown): number | null {
  if (value == null || value === '' || value === INHERIT) return null;
  const points = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(points) ? points : null;
}

/** Line spacing the paragraph states, as a multiple of single; null when it inherits. */
export function spacingOf(value: unknown): number | null {
  const multiple = typeof value === 'number' ? value : Number(value);
  return value != null && Number.isFinite(multiple) && multiple > 0 ? multiple : null;
}

export function colorOf(value: unknown): string {
  if (typeof value !== 'string') return '';
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
  return match?.[1] ?? '';
}

const ALIGNS: readonly ParagraphAlign[] = ['left', 'center', 'right', 'justify'];

/** Alignment stated on the paragraph, or null when it inherits the role's. */
export function alignOf(value: unknown): ParagraphAlign | null {
  return ALIGNS.find((align) => align === value) ?? null;
}

export function fontOf(value: unknown): string {
  if (typeof value !== 'string') return '';
  const name = value.trim().replace(/^["']+|["']+$/g, '');
  return name;
}

/** A bold/italic mark wins. An explicit mode without the mark is "off", not inherit. */
function flag(hasMark: boolean, mode: unknown): boolean | null {
  if (hasMark) return true;
  if (mode === MODE_TRUE || mode === MODE_FALSE) return false;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface DocMark {
  type: string;
  attrs?: Record<string, string>;
}

function marksFor(run: TextRun): DocMark[] {
  const attrs: Record<string, string> = {};
  const font = run.font.trim();
  if (font) attrs.fontFamily = font;
  if (run.sizePt != null && run.sizePt > 0) attrs.fontSize = String(run.sizePt);
  if (/^[0-9a-fA-F]{6}$/.test(run.color)) attrs.color = `#${run.color}`;
  if (run.bold === true) attrs.boldMode = MODE_TRUE;
  if (run.bold === false) attrs.boldMode = MODE_FALSE;
  if (run.italic === true) attrs.italicMode = MODE_TRUE;
  if (run.italic === false) attrs.italicMode = MODE_FALSE;
  if (run.underline === true) attrs.underlineMode = MODE_TRUE;
  if (run.underline === false) attrs.underlineMode = MODE_FALSE;
  if (run.underline === null) attrs.underlineMode = INHERIT;
  if (run.letterSpacingPt === null) attrs.letterSpacing = INHERIT;
  else if (run.letterSpacingPt != null && Number.isFinite(run.letterSpacingPt)) {
    attrs.letterSpacing = String(run.letterSpacingPt);
  }

  const marks: DocMark[] = [];
  if (Object.keys(attrs).length > 0) marks.push({ type: 'textStyle', attrs });
  if (run.bold === true) marks.push({ type: 'bold' });
  if (run.italic === true) marks.push({ type: 'italic' });
  return marks;
}

function sameStyle(left: TextRun, right: TextRun): boolean {
  return (
    left.font === right.font &&
    left.sizePt === right.sizePt &&
    left.bold === right.bold &&
    left.italic === right.italic &&
    (left.underline ?? null) === (right.underline ?? null) &&
    (left.letterSpacingPt ?? null) === (right.letterSpacingPt ?? null) &&
    left.color === right.color
  );
}

function mergeRuns(runs: readonly TextRun[]): TextRun[] {
  const merged: TextRun[] = [];
  for (const run of runs) {
    const previous = merged.at(-1);
    if (previous && sameStyle(previous, run)) {
      merged[merged.length - 1] = { ...previous, text: previous.text + run.text };
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

/** Runs become a paragraph document. Empty runs are omitted: a text node cannot be empty. */
export function paragraphsToDoc(paragraphs: readonly Paragraph[]): JSONContent {
  const content = (
    paragraphs.length > 0 ? paragraphs : [{ level: 0, runs: [], lineSpacing: null }]
  ).map((paragraph) => {
    const runs = paragraph.runs.flatMap((run) => {
      const text = editorText(run.text);
      if (text === '') return [];
      const marks = marksFor({ ...run, text });
      const node: JSONContent = { type: 'text', text };
      if (marks.length > 0) node.marks = marks;
      return [node];
    });
    const node: JSONContent = {
      type: 'paragraph',
      attrs: {
        level: levelOf(paragraph.level),
        align: paragraph.align === null ? INHERIT : alignOf(paragraph.align),
        lineSpacing: spacingOf(paragraph.lineSpacing),
      },
    };
    if (runs.length > 0) node.content = runs;
    return node;
  });
  return { type: 'doc', content };
}

function runFrom(node: Record<string, unknown>): TextRun | null {
  if (node.type !== 'text' || typeof node.text !== 'string' || node.text === '') return null;
  const marks = Array.isArray(node.marks) ? node.marks : [];
  const style = marks.find((mark) => isRecord(mark) && mark.type === 'textStyle');
  const attrs = style && isRecord(style) && isRecord(style.attrs) ? style.attrs : {};
  const has = (type: string) => marks.some((mark) => isRecord(mark) && mark.type === type);
  const run: TextRun = {
    text: node.text,
    font: fontOf(attrs.fontFamily),
    sizePt: sizeOf(attrs.fontSize),
    bold: flag(has('bold'), attrs.boldMode),
    italic: flag(has('italic'), attrs.italicMode),
    color: colorOf(attrs.color),
  };
  // Underline and letter spacing are optional in the contract: a run that never had them
  // keeps no key, and one that stated null keeps its null.
  if (attrs.underlineMode === MODE_TRUE) run.underline = true;
  else if (attrs.underlineMode === MODE_FALSE) run.underline = false;
  else if (attrs.underlineMode === INHERIT) run.underline = null;
  if (attrs.letterSpacing === INHERIT) run.letterSpacingPt = null;
  else {
    const spacing = letterSpacingOf(attrs.letterSpacing);
    if (spacing != null) run.letterSpacingPt = spacing;
  }
  return run;
}

/** The editor document, read back as paragraphs. At least one paragraph, so `set-text` accepts it. */
export function documentToParagraphs(doc: JSONContent): Paragraph[] {
  const blocks = Array.isArray(doc.content) ? doc.content : [];
  const paragraphs = blocks.flatMap((block) => {
    if (!isRecord(block) || block.type !== 'paragraph') return [];
    const attrs = isRecord(block.attrs) ? block.attrs : {};
    const children = Array.isArray(block.content) ? block.content : [];
    const runs = mergeRuns(
      children.flatMap((child) => {
        if (!isRecord(child)) return [];
        const run = runFrom(child);
        return run ? [run] : [];
      }),
    );
    const paragraph: Paragraph = {
      level: levelOf(attrs.level),
      runs,
      lineSpacing: spacingOf(attrs.lineSpacing),
    };
    if (attrs.align === INHERIT) return [{ ...paragraph, align: null }];
    const align = alignOf(attrs.align);
    return [align ? { ...paragraph, align } : paragraph];
  });
  return paragraphs.length > 0 ? paragraphs : [{ level: 0, runs: [], lineSpacing: null }];
}

/**
 * Paragraphs to write into the deck, or null when the editor document is untouched.
 * Closing without a change must not rewrite inherited runs into a new `set-text`.
 */
export function paragraphsToCommit(
  baseline: JSONContent,
  current: JSONContent,
): Paragraph[] | null {
  if (JSON.stringify(baseline) === JSON.stringify(current)) return null;
  return documentToParagraphs(current);
}

/** One run of pasted text and the only formatting a paste keeps: bold, italic, underline. */
export interface PastedRun {
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
}

/** A pasted paragraph: its runs, possibly none (an empty line). */
export type PastedParagraph = readonly PastedRun[];

/**
 * Plain clipboard text as paragraphs: each line is a paragraph (a list item in a bullet list),
 * as in Google Slides and PowerPoint. One trailing line break is dropped: a copied line usually
 * carries it, and an empty bullet at the end is never what was meant.
 */
export function plainParagraphs(text: string): PastedParagraph[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  return lines.map((line) => (line === '' ? [] : [{ text: line }]));
}

/**
 * The part of a DOM node the HTML reader needs. `DOMParser` output fits it in the browser; tests
 * build the tree by hand, so the reader runs without a DOM.
 */
export interface HtmlNodeLike {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly nodeValue: string | null;
  readonly childNodes: ArrayLike<HtmlNodeLike>;
  getAttribute?(name: string): string | null;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** Elements that end a line: Word, Google Docs and browsers wrap each paragraph in one. */
const BLOCKS: ReadonlySet<string> = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DD',
  'DIV',
  'DL',
  'DT',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'TBODY',
  'TD',
  'TH',
  'THEAD',
  'TR',
  'UL',
]);

/** Never text: Word puts its styles and conditional comments into the clipboard HTML. */
const SKIPPED: ReadonlySet<string> = new Set([
  'HEAD',
  'LINK',
  'META',
  'NOSCRIPT',
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
  'TITLE',
]);

interface Flags {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
}

/** One declaration of an inline `style`, lower-cased; null when it is not there. */
function declaration(style: string, property: string): string | null {
  for (const part of style.split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    if (part.slice(0, colon).trim().toLowerCase() !== property) continue;
    return part
      .slice(colon + 1)
      .replace(/!important/i, '')
      .trim()
      .toLowerCase();
  }
  return null;
}

/**
 * Bold, italic and underline of an element: the tag says it, its inline style overrides. Google
 * Docs wraps the whole copy in `<b style="font-weight:normal">`, and that is not bold.
 */
function flagsOf(node: HtmlNodeLike, outer: Flags): Flags {
  const tag = node.nodeName.toUpperCase();
  let { bold, italic, underline } = outer;
  if (tag === 'B' || tag === 'STRONG') bold = true;
  if (tag === 'I' || tag === 'EM') italic = true;
  if (tag === 'U' || tag === 'INS') underline = true;
  const style = node.getAttribute?.('style') ?? '';
  if (!style) return { bold, italic, underline };
  const weight = declaration(style, 'font-weight');
  if (weight) {
    const numeric = Number(weight);
    if (weight === 'bold' || weight === 'bolder' || numeric >= 600) bold = true;
    else if (weight === 'normal' || weight === 'lighter' || numeric > 0) bold = false;
  }
  const slant = declaration(style, 'font-style');
  if (slant === 'italic' || slant?.startsWith('oblique')) italic = true;
  else if (slant === 'normal') italic = false;
  const line = declaration(style, 'text-decoration-line') ?? declaration(style, 'text-decoration');
  if (line?.includes('underline')) underline = true;
  else if (line === 'none') underline = false;
  return { bold, italic, underline };
}

function sameFlags(left: PastedRun, right: PastedRun): boolean {
  return (
    (left.bold ?? false) === (right.bold ?? false) &&
    (left.italic ?? false) === (right.italic ?? false) &&
    (left.underline ?? false) === (right.underline ?? false)
  );
}

/** Leading space of the first run and trailing space of the last: HTML indentation, not text. */
function trimmed(runs: readonly PastedRun[]): PastedRun[] {
  const out = [...runs];
  while (out.length > 0) {
    const first = out[0] as PastedRun;
    const text = first.text.replace(/^ +/, '');
    if (text !== '') {
      out[0] = { ...first, text };
      break;
    }
    out.shift();
  }
  while (out.length > 0) {
    const last = out[out.length - 1] as PastedRun;
    const text = last.text.replace(/ +$/, '');
    if (text !== '') {
      out[out.length - 1] = { ...last, text };
      break;
    }
    out.pop();
  }
  return out;
}

/**
 * Clipboard HTML (Word, Google Docs, a web page) as paragraphs. Only bold, italic and underline
 * survive; font, size and colour come from the text being edited, as for typed text. Blocks and
 * `<br>` start a new paragraph. A paragraph with no text at all is dropped: HTML nests blocks,
 * and an empty one there is layout, not an empty line.
 */
export function htmlParagraphs(root: HtmlNodeLike): PastedParagraph[] {
  const paragraphs: PastedParagraph[] = [];
  let runs: PastedRun[] = [];
  const flush = () => {
    const done = trimmed(runs);
    if (done.length > 0) paragraphs.push(done);
    runs = [];
  };
  const add = (text: string, flags: Flags) => {
    let collapsed = text.replace(/[\t\n\r\f ]+/g, ' ').replaceAll(' ', ' ');
    // A space after a space collapses across runs too, as the browser shows it.
    const previous = runs.at(-1);
    if (previous?.text.endsWith(' ')) collapsed = collapsed.replace(/^ /, '');
    if (collapsed === '') return;
    const run: PastedRun = {
      text: collapsed,
      ...(flags.bold ? { bold: true } : {}),
      ...(flags.italic ? { italic: true } : {}),
      ...(flags.underline ? { underline: true } : {}),
    };
    if (previous && sameFlags(previous, run)) {
      runs[runs.length - 1] = { ...previous, text: previous.text + run.text };
    } else {
      runs.push(run);
    }
  };
  const walk = (node: HtmlNodeLike, flags: Flags) => {
    if (node.nodeType === TEXT_NODE) {
      add(node.nodeValue ?? '', flags);
      return;
    }
    // Comments (Word's conditional ones among them) are not text. The root may be a fragment.
    if (node.nodeType !== ELEMENT_NODE && node.childNodes.length === 0) return;
    const tag = node.nodeName.toUpperCase();
    if (SKIPPED.has(tag)) return;
    // Word draws list markers as text in a span it marks to ignore; the list here draws its own.
    const style = node.getAttribute?.('style') ?? '';
    if (/mso-list\s*:\s*ignore/i.test(style)) return;
    if (tag === 'BR') {
      flush();
      return;
    }
    const block = BLOCKS.has(tag);
    if (block) flush();
    const inner = node.nodeType === ELEMENT_NODE ? flagsOf(node, flags) : flags;
    for (let index = 0; index < node.childNodes.length; index += 1) {
      const child = node.childNodes[index];
      if (child) walk(child, inner);
    }
    if (block) flush();
  };
  walk(root, { bold: false, italic: false, underline: false });
  flush();
  return paragraphs;
}

function textStyleOf(marks: readonly Mark[]): Record<string, unknown> {
  return marks.find((mark) => mark.type.name === 'textStyle')?.attrs ?? {};
}

/**
 * Pasted paragraphs as a slice for the caret. Each run takes the marks at the caret — the font,
 * size and colour the next typed letter would get — and adds only its own bold, italic and
 * underline. New paragraphs copy the caret paragraph's level, alignment and spacing, so pasted
 * lines become items of the same list.
 */
export function pastedSlice(state: EditorState, paragraphs: readonly PastedParagraph[]): Slice {
  const { schema, selection } = state;
  const base = state.storedMarks ?? selection.$from.marks();
  const attrs = selection.$from.parent.attrs;
  const { bold, italic, textStyle } = schema.marks;
  const marksFor = (run: PastedRun): readonly Mark[] => {
    let marks = base;
    const extra: Record<string, string> = {};
    if (run.bold && bold) {
      marks = bold.create().addToSet(marks);
      extra.boldMode = MODE_TRUE;
    }
    if (run.italic && italic) {
      marks = italic.create().addToSet(marks);
      extra.italicMode = MODE_TRUE;
    }
    if (run.underline) extra.underlineMode = MODE_TRUE;
    if (textStyle && Object.keys(extra).length > 0) {
      marks = textStyle.create({ ...textStyleOf(marks), ...extra }).addToSet(marks);
    }
    return marks;
  };
  const paragraph = schema.nodes.paragraph;
  if (!paragraph) return Slice.empty;
  const nodes = (paragraphs.length > 0 ? paragraphs : [[]]).map((runs) =>
    paragraph.create(
      attrs,
      runs.filter((run) => run.text !== '').map((run) => schema.text(run.text, marksFor(run))),
    ),
  );
  return new Slice(Fragment.from(nodes), 1, 1);
}

/**
 * Paste into the open editor. Several lines become several paragraphs; HTML from Word or Google
 * Docs keeps bold, italic and underline and takes everything else from the text being edited.
 * `parseHtml` turns clipboard HTML into a tree (in the browser, `DOMParser`); without it, or
 * when the HTML holds no text, the plain text is pasted.
 */
export function pasteText(
  view: {
    readonly state: EditorState;
    dispatch: (transaction: Transaction) => void;
  },
  event: Pick<ClipboardEvent, 'clipboardData' | 'preventDefault'>,
  parseHtml?: (html: string) => HtmlNodeLike | null,
): boolean {
  const data = event.clipboardData;
  if (!data) return false;
  const html = data.getData('text/html');
  const text = data.getData('text/plain');
  const tree = html && parseHtml ? parseHtml(html) : null;
  const fromHtml = tree ? htmlParagraphs(tree) : [];
  const paragraphs = fromHtml.length > 0 ? fromHtml : text ? plainParagraphs(text) : [];
  // Files or pictures only: not ours, the canvas decides.
  if (!html && !text) return false;
  event.preventDefault();
  if (paragraphs.length === 0) return true;
  const { state } = view;
  view.dispatch(state.tr.replaceSelection(pastedSlice(state, paragraphs)).scrollIntoView());
  return true;
}

/** Browser reader for `pasteText`. Parsing into a detached document runs no scripts. */
export function parseClipboardHtml(html: string): HtmlNodeLike | null {
  if (typeof DOMParser === 'undefined') return null;
  return new DOMParser().parseFromString(html, 'text/html').body;
}

/** Letters, digits and marks make a word. */
const WORD_CHAR = /[\p{L}\p{N}\p{M}_]/u;
/** Joins two word characters into one word: «из-за», «don't». */
const JOINER = /['’-]/u;

/**
 * The word at `offset` in a paragraph's text, as `[from, to)` in UTF-16 units, the way
 * ProseMirror counts. The caret right after a word still names that word. Null when there is
 * no word there: a space, punctuation, an empty line. Double-click selects it.
 */
export function wordAt(text: string, offset: number): readonly [number, number] | null {
  const chars = [...text];
  const units: number[] = [];
  let unit = 0;
  for (const char of chars) {
    units.push(unit);
    unit += char.length;
  }
  units.push(unit);
  const isWord = (index: number): boolean => {
    const char = chars[index];
    if (char === undefined) return false;
    if (WORD_CHAR.test(char)) return true;
    return (
      JOINER.test(char) &&
      WORD_CHAR.test(chars[index - 1] ?? '') &&
      WORD_CHAR.test(chars[index + 1] ?? '')
    );
  };
  // The character that starts at the offset, or the one the offset falls inside.
  let at = units.findIndex((value) => value > offset) - 1;
  if (at < 0) at = chars.length;
  const index = isWord(at) ? at : isWord(at - 1) ? at - 1 : -1;
  if (index < 0) return null;
  let start = index;
  while (isWord(start - 1)) start -= 1;
  let end = index;
  while (isWord(end + 1)) end += 1;
  return [units[start] ?? 0, units[end + 1] ?? unit];
}

/** Deepest paragraph level: OOXML has nine, `lvl` 0…8. */
export const MAX_LEVEL = 8;

/** Level after Tab (`+1`) or Shift+Tab (`-1`), kept within 0…`MAX_LEVEL`. */
export function steppedLevel(level: unknown, step: -1 | 1): number {
  return Math.min(MAX_LEVEL, Math.max(0, levelOf(level) + step));
}

function leadSize(node: ProseMirrorNode, inherited: number): number {
  const mark = node.firstChild?.marks.find((item) => item.type.name === 'textStyle');
  return sizeOf(mark?.attrs.fontSize) ?? inherited;
}

function slideParagraph(metrics: TextEditorMetrics) {
  return ParagraphNode.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        level: {
          default: 0,
          parseHTML: () => 0,
          renderHTML: () => ({}),
        },
        align: {
          default: null,
          parseHTML: () => null,
          renderHTML: () => ({}),
        },
        // Multiple of single spacing; null inherits the role's. Painted as `line-height`.
        lineSpacing: {
          default: null,
          parseHTML: () => null,
          renderHTML: () => ({}),
        },
      };
    },
    renderHTML({ node, HTMLAttributes }) {
      return [
        'p',
        mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
          style: paragraphStyle(node, metrics),
        }),
        0,
      ];
    },
    // The paragraph's font size follows its first run, and ProseMirror does not redraw a node
    // when only the marks inside it change. Without this view a size picked for the words
    // keeps the old paragraph size: tighter spacing than on the slide, so the auto-height
    // frame measured in the editor comes out shorter than the text drawn after closing.
    addNodeView() {
      return ({ node: first, HTMLAttributes }) => {
        const dom = document.createElement('p');
        for (const [name, value] of Object.entries(
          mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
        )) {
          if (name !== 'style' && typeof value === 'string') dom.setAttribute(name, value);
        }
        let style = paragraphStyle(first, metrics);
        dom.setAttribute('style', style);
        return {
          dom,
          contentDOM: dom,
          update: (next: ProseMirrorNode) => {
            if (next.type !== first.type) return false;
            const nextStyle = paragraphStyle(next, metrics);
            if (nextStyle !== style) {
              style = nextStyle;
              dom.setAttribute('style', style);
            }
            return true;
          },
          ignoreMutation: (mutation: MutationRecord | { type: 'selection' }) =>
            mutation.type === 'attributes' &&
            'attributeName' in mutation &&
            mutation.target === dom &&
            mutation.attributeName === 'style',
        };
      };
    },
  });
}

/** Inline style of a paragraph: size of its first run, level, alignment and spacing. */
export function paragraphStyle(node: ProseMirrorNode, metrics: TextEditorMetrics): string {
  const level = levelOf(node.attrs.level);
  const points = leadSize(node, metrics.inheritedSizePt);
  const indent = level * 1.5;
  const padding = metrics.bullets ? indent + 1.15 : indent;
  const style = [`font-size: ${cqw(ptToCqw(points, metrics.slide))}`];
  if (padding > 0) style.push(`padding-left: ${padding}em`);
  if (metrics.bullets) style.push(`--bullet-x: ${indent}em`);
  const align = alignOf(node.attrs.align);
  if (align) style.push(`text-align: ${align}`);
  // The paragraph's own spacing wins over the role's, as on the slide.
  const lineSpacing = spacingOf(node.attrs.lineSpacing);
  if (lineSpacing != null) style.push(`line-height: ${lineSpacing}`);
  return style.join('; ');
}

function slideFontFamily() {
  return FontFamily.extend({
    addGlobalAttributes() {
      return [
        {
          types: ['textStyle'],
          attributes: {
            fontFamily: {
              default: null,
              parseHTML: () => null,
              renderHTML: (attributes: { fontFamily?: unknown }) => {
                const quoted = fontFamily(fontOf(attributes.fontFamily));
                if (!quoted) return {};
                return { style: `font-family: ${quoted}` };
              },
            },
          },
        },
      ];
    },
  });
}

function slideFontSize(slide: SlideSize) {
  return FontSize.extend({
    addGlobalAttributes() {
      return [
        {
          types: ['textStyle'],
          attributes: {
            fontSize: {
              default: null,
              parseHTML: (element: HTMLElement) => element.dataset.sizePt ?? null,
              renderHTML: (attributes: { fontSize?: unknown }) => {
                const points = sizeOf(attributes.fontSize);
                if (points == null) return {};
                return {
                  'data-size-pt': String(points),
                  style: `font-size: ${cqw(ptToCqw(points, slide))}`,
                };
              },
            },
          },
        },
      ];
    },
  });
}

/** Letter spacing in points, painted in `cqw` like the size, so it tracks the frame. */
function slideLetterSpacing(slide: SlideSize) {
  return Extension.create({
    name: 'letterSpacing',
    addGlobalAttributes() {
      return [
        {
          types: ['textStyle'],
          attributes: {
            letterSpacing: {
              default: null,
              parseHTML: () => null,
              renderHTML: (attributes: { letterSpacing?: unknown }) => {
                const points = letterSpacingOf(attributes.letterSpacing);
                if (points == null) return {};
                return { style: `letter-spacing: ${cqw(ptToCqw(points, slide))}` };
              },
            },
          },
        },
      ];
    },
  });
}

/** Explicit bold/italic, including "off", which the mark alone cannot tell from inherit. */
function runModes() {
  return Extension.create({
    name: 'runModes',
    addGlobalAttributes() {
      return [
        {
          types: ['textStyle'],
          attributes: {
            boldMode: {
              default: null,
              parseHTML: () => null,
              renderHTML: (attributes: { boldMode?: unknown }) => {
                // `strong` paints an explicit bold. Only an explicit "off" needs a weight,
                // so it does not inherit a bold type role.
                if (attributes.boldMode === MODE_FALSE) return { style: 'font-weight: 400' };
                return {};
              },
            },
            italicMode: {
              default: null,
              parseHTML: () => null,
              renderHTML: (attributes: { italicMode?: unknown }) => {
                if (attributes.italicMode === MODE_FALSE) return { style: 'font-style: normal' };
                return {};
              },
            },
            // Underline has no mark in this Tiptap line without another package, so it rides
            // on the text style like the explicit modes above.
            underlineMode: {
              default: null,
              parseHTML: () => null,
              renderHTML: (attributes: { underlineMode?: unknown }) => {
                if (attributes.underlineMode === MODE_TRUE) {
                  return { style: 'text-decoration: underline' };
                }
                return {};
              },
            },
          },
        },
      ];
    },
  });
}

/**
 * The text schema: paragraph → text, with bold, italic, font, size, letter spacing and colour.
 * `@tiptap/extension-history` is UndoRedo from `@tiptap/extensions` (same MIT line).
 * Size lives on the text-style package; there is no separate font-size package in this line.
 */
export function textExtensions(metrics: TextEditorMetrics): Extensions {
  return [
    Document.extend({ content: 'paragraph+' }),
    slideParagraph(metrics),
    Text,
    Bold,
    Italic,
    TextStyle,
    Color,
    slideFontFamily(),
    slideFontSize(metrics.slide),
    slideLetterSpacing(metrics.slide),
    runModes(),
    History,
  ];
}
