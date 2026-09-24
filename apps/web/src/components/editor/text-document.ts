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
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
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

/** Vertical tab and the Unicode line separator are line breaks on the slide. */
function editorText(text: string): string {
  return text.replaceAll('\v', '\n').replaceAll('\u2028', '\n');
}

function levelOf(value: unknown): number {
  const level = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(level) || level <= 0) return 0;
  return Math.floor(level);
}

function sizeOf(value: unknown): number | null {
  const points =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(points) && points > 0 ? points : null;
}

/** Line spacing the paragraph states, as a multiple of single; null when it inherits. */
function spacingOf(value: unknown): number | null {
  const multiple = typeof value === 'number' ? value : Number(value);
  return value != null && Number.isFinite(multiple) && multiple > 0 ? multiple : null;
}

function colorOf(value: unknown): string {
  if (typeof value !== 'string') return '';
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
  return match?.[1] ?? '';
}

const ALIGNS: readonly ParagraphAlign[] = ['left', 'center', 'right', 'justify'];

/** Alignment stated on the paragraph, or null when it inherits the role's. */
export function alignOf(value: unknown): ParagraphAlign | null {
  return ALIGNS.find((align) => align === value) ?? null;
}

function fontOf(value: unknown): string {
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
        align: alignOf(paragraph.align),
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
  // Underline is optional in the contract: a run that never had it keeps no key.
  if (attrs.underlineMode === MODE_TRUE) return { ...run, underline: true };
  if (attrs.underlineMode === MODE_FALSE) return { ...run, underline: false };
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

/**
 * Paste the clipboard's plain text and nothing else. Marks at the caret stay;
 * bold and colour from the HTML clipboard do not.
 */
export function pasteAsPlainText<Step>(
  view: {
    state: { readonly tr: { insertText: (text: string) => Step } };
    dispatch: (step: Step) => void;
  },
  event: ClipboardEvent,
): boolean {
  const text = event.clipboardData?.getData('text/plain');
  if (text == null) return false;
  event.preventDefault();
  view.dispatch(view.state.tr.insertText(text));
  return true;
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
        // Carried through untouched so editing the words keeps the template's spacing.
        lineSpacing: {
          default: null,
          parseHTML: () => null,
          renderHTML: () => ({}),
        },
      };
    },
    renderHTML({ node, HTMLAttributes }) {
      const level = levelOf(node.attrs.level);
      const points = leadSize(node, metrics.inheritedSizePt);
      const indent = level * 1.5;
      const padding = metrics.bullets ? indent + 1.15 : indent;
      const style = [`font-size: ${cqw(ptToCqw(points, metrics.slide))}`];
      if (padding > 0) style.push(`padding-left: ${padding}em`);
      if (metrics.bullets) style.push(`--bullet-x: ${indent}em`);
      const align = alignOf(node.attrs.align);
      if (align) style.push(`text-align: ${align}`);
      return [
        'p',
        mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { style: style.join('; ') }),
        0,
      ];
    },
  });
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
 * The text schema: paragraph → text, with bold, italic, font, size and colour.
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
    runModes(),
    History,
  ];
}
