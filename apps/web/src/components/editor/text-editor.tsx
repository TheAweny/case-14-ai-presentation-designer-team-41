'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  KEEPS_TEXT_FOCUS,
  clearActiveTextEditor,
  setActiveTextEditor,
} from '@/components/editor/active-text-editor';
import { useTranslations } from 'next-intl';
import type { Editor, JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Box, DesignSystem, Paragraph, SlideElement } from '@lct/contracts';
import {
  boxStyle,
  cqw,
  createTypeResolver,
  EMU_PER_PT,
  fontFamily,
  lineHeightOf,
  paint,
  ptToCqw,
  typeRoleOf,
  type SlideSize,
} from '@lct/slide-renderer';
import {
  paragraphsToCommit,
  paragraphsToDoc,
  parseClipboardHtml,
  pasteText,
  textExtensions,
  wordAt,
} from '@/components/editor/text-document';
import { fitTextBox, pxToEmu, textFitOf, type FittedBox } from '@/components/editor/text-fit';
import { TextFormatBar } from '@/components/editor/text-format';
import { editorCommand } from '@/components/editor/editor-keymap';
import {
  canIndent,
  runTextCommand,
  sizeLadder,
  type InheritedText,
} from '@/components/editor/text-shortcuts';

type TextElement = Extract<SlideElement, { kind: 'text' }>;

const EDITOR_CSS = `
/* Холст не выделяет текст страницы при жестах, а в поле набора выделение — обычное. Рамка
   показывает, где кончается блок и куда уйдёт перенос; переполнение рамки шаблона — пунктиром. */
[data-text-editor] {
  user-select: text;
  -webkit-user-select: text;
  outline: 1px solid color-mix(in oklab, var(--canvas-selection) 70%, transparent);
}
[data-text-editor][data-overflow='true'] {
  outline: 1.5px dashed var(--canvas-snap);
}
[data-text-editor] .ProseMirror {
  min-height: 100%;
  outline: none;
  caret-color: currentColor;
}
[data-text-editor] .ProseMirror p {
  margin: 0;
}
/* В фигуре поле ровно по тексту: якорь (по центру, сверху, снизу) ставит рамка вокруг. */
[data-text-editor][data-in-shape] .ProseMirror {
  min-height: 0;
}
/* Жирный — ровно 700, как на слайде: у strong по умолчанию bolder, и поверх жирной роли
   получалось 900 — шире, с другими переносами, чем у текста до двойного клика. */
[data-text-editor] .ProseMirror strong {
  font-weight: 700;
}
[data-text-editor] .ProseMirror p + p {
  margin-top: 0.35em;
}
[data-text-editor][data-bullets='true'] .ProseMirror p {
  position: relative;
}
[data-text-editor][data-bullets='true'] .ProseMirror p::before {
  content: '';
  position: absolute;
  left: var(--bullet-x, 0em);
  top: 0.48em;
  width: 0.38em;
  height: 0.38em;
  border-radius: 50%;
  background: currentColor;
}
/* Абзац из файла ставит себе поля и интервалы сам; перед первым абзацем интервала нет, как на
   слайде. Маркер — его собственный символ в висячем отступе, а не точка роли. */
[data-text-editor] .ProseMirror p:first-child {
  margin-top: 0 !important;
}
[data-text-editor] .ProseMirror p[data-stated] {
  position: relative;
}
[data-text-editor] .ProseMirror p[data-stated]::before {
  content: none;
}
[data-text-editor] .ProseMirror p[data-stated][data-bullet]::before {
  content: attr(data-bullet);
  position: absolute;
  left: var(--bullet-x, 0em);
  top: 0;
  width: auto;
  height: auto;
  border-radius: 0;
  background: none;
  text-indent: 0;
}
`;

function inheritedLook(profile: DesignSystem, element: TextElement, slideCy: number) {
  const role = typeRoleOf(element.role);
  const style = profile.typeScale.find((entry) => entry.role === role);
  const type = createTypeResolver(profile, slideCy);
  return {
    fontFamily: fontFamily(style?.font ?? ''),
    sizePt: type.sizeEmu(element.role) / EMU_PER_PT,
    bold: type.bold(element.role),
    italic: type.italic(element.role),
    lineHeight: lineHeightOf(type.lineSpacing(element.role)),
    color: paint(profile.palette, style?.colorRole ?? 'text', 'text'),
  };
}

function editorHasFocus(editor: Editor | null): boolean {
  if (!editor) return false;
  try {
    const active = document.activeElement;
    return active instanceof Node && editor.view.dom.contains(active);
  } catch {
    return false;
  }
}

/** Фокус в органах управления текстом: набор продолжается. */
function focusKept(): boolean {
  const active = document.activeElement;
  return active instanceof Element && active.closest(KEEPS_TEXT_FOCUS) !== null;
}

/** Слово под точкой двойного клика, как в Slides и PowerPoint; мимо слов — каретка. */
function selectWordAt(editor: Editor, pos: number) {
  const $pos = editor.state.doc.resolve(pos);
  const word = wordAt($pos.parent.textContent, $pos.parentOffset);
  if (!word) {
    editor.commands.setTextSelection(pos);
    return;
  }
  const start = $pos.start();
  editor.commands.setTextSelection({ from: start + word[0], to: start + word[1] });
}

function placeCaret(
  editor: Editor,
  origin: { readonly x: number; readonly y: number } | null,
  typed: string | null,
) {
  try {
    if (typed) {
      // Печать на выделенной рамке, как в Google Slides: символ — в конец текста. Весь текст
      // не заменяется: случайная клавиша не стирает слайд, а Ctrl+A и печать заменят всё.
      editor.commands.focus('end', { scrollIntoView: false });
      editor.view.dispatch(editor.state.tr.insertText(typed));
      return;
    }
    if (origin) {
      const coords = editor.view.posAtCoords({ left: origin.x, top: origin.y });
      if (coords) selectWordAt(editor, coords.pos);
    } else {
      // Вход с клавиатуры (Enter, F2), как в Figma и PowerPoint: выделен весь текст. Текстовым
      // выделением, а не AllSelection: напечатанное поверх сохраняет уровень и выравнивание
      // первого абзаца, а End и стрелки сразу снимают выделение.
      editor.commands.setTextSelection({ from: 0, to: editor.state.doc.content.size });
    }
    editor.commands.focus(null, { scrollIntoView: false });
  } catch {
    editor.commands.focus('end', { scrollIntoView: false });
  }
}

/** Высота текста в поле, экранные px: от верха поля до низа последнего абзаца. */
function contentHeightPx(dom: HTMLElement): number {
  const last = dom.lastElementChild;
  if (!last) return 0;
  return last.getBoundingClientRect().bottom - dom.getBoundingClientRect().top;
}

/**
 * Пока поле открыто, исходный текст под ним не виден. Правило, а не запись в стиль узла.
 * У фигуры прячется только её текст: сама фигура остаётся фоном поля.
 */
function hiddenSourceCss(elementId: string, inShape = false): string {
  const part = inShape ? ' [data-shape-text]' : '';
  return `[data-canvas-slide] [data-slide-root] > [data-element-id="${CSS.escape(elementId)}"]${part} { visibility: hidden; }`;
}

/**
 * Набор внутри фигуры: вид текста берётся у фигуры (тип основного текста, цвет под заливку),
 * а `style` ставит поле внутрь её полей и по её якорю. Фигура под текст не растёт: лишний
 * текст подсвечивается, как у рамки шаблона.
 */
export interface ShapeTextFrame {
  readonly look: ReturnType<typeof inheritedLook>;
  readonly style: CSSProperties;
}

/**
 * Набор по двойному клику. Пока поле открыто, отмену делает History редактора.
 * В журнал колоды текст попадает один раз, когда поле закрывается.
 */
export function TextEditor({
  slideRoot,
  element,
  profile,
  slide,
  origin,
  typed = null,
  finishRef,
  onCommit,
  onClose,
  shape,
}: {
  /** Кадр открытого слайда: поле встаёт в него поверх исходного текста. */
  slideRoot: HTMLElement;
  element: TextElement;
  profile: DesignSystem;
  /** Размер слайда в EMU: от него кегль в `cqw`. */
  slide: SlideSize;
  origin: { readonly x: number; readonly y: number } | null;
  /** Набор открыт печатью на выделенной рамке: этот символ дописывается в конец. */
  typed?: string | null;
  /**
   * Сюда поле кладёт своё закрытие: холст зовёт его по клику мимо поля и при смене выделения.
   * Mousedown у Selecto не отдаёт фокус, так что одного blur для этого мало.
   */
  finishRef?: { current: (() => void) | null };
  /**
   * Текст после набора. `box` — рамка, если она выросла под текст: её пишут той же записью
   * журнала, что и текст, и одна отмена возвращает оба.
   */
  onCommit: (paragraphs: readonly Paragraph[], box?: Box) => void;
  onClose: () => void;
  /** Текст в фигуре, а не текстовый блок: см. `ShapeTextFrame`. */
  shape?: ShapeTextFrame;
}) {
  const t = useTranslations('editor');
  const look = shape?.look ?? inheritedLook(profile, element, slide.cy);
  const bullets = element.role === 'bullet-list';
  const indentable = canIndent(element.role);
  const fit = shape ? 'fixed' : textFitOf(element);
  const base = element.box;
  const [fitted, setFitted] = useState<FittedBox>({ box: base, overflow: false });
  const fittedRef = useRef(fitted);
  fittedRef.current = fitted;
  /** Рамка для записи: только если выросла. */
  const grownBox = (): Box | undefined => {
    const box = fittedRef.current.box;
    return box.cy !== base.cy ? box : undefined;
  };
  const grownBoxRef = useRef(grownBox);
  grownBoxRef.current = grownBox;
  const extensions = useMemo(
    () =>
      textExtensions({
        slide: { cx: slide.cx, cy: slide.cy },
        inheritedSizePt: look.sizePt,
        bullets,
      }),
    [bullets, look.sizePt, slide.cx, slide.cy],
  );
  const onCommitRef = useRef(onCommit);
  const onCloseRef = useRef(onClose);
  const editorRef = useRef<Editor | null>(null);
  const baseline = useRef<JSONContent | null>(null);
  const closed = useRef(false);
  const mounted = useRef(false);
  const ready = useRef(false);
  const epoch = useRef(0);
  onCommitRef.current = onCommit;
  onCloseRef.current = onClose;
  // Клавиши набора читают текущий стиль роли и шкалу, не пересоздавая редактор.
  const keys = useRef<{
    inherited: InheritedText;
    ladder: readonly number[];
    indentable: boolean;
  }>({
    inherited: look,
    ladder: [],
    indentable,
  });
  keys.current = { inherited: look, ladder: sizeLadder(profile), indentable };

  // Замер высоты текста: поле растёт вместе с ним (`grow`) или подсвечивает переполнение.
  const measure = useRef<() => void>(() => undefined);
  measure.current = () => {
    const current = editorRef.current;
    if (!current || current.isDestroyed) return;
    const width = slideRoot.getBoundingClientRect().width;
    const contentCy = pxToEmu(contentHeightPx(current.view.dom), width, slide.cx);
    const next = fitTextBox(base, contentCy, fit, pxToEmu(1, width, slide.cx));
    const { box, overflow } = fittedRef.current;
    const same =
      overflow === next.overflow &&
      box.x === next.box.x &&
      box.y === next.box.y &&
      box.cx === next.box.cx &&
      box.cy === next.box.cy;
    if (same) return;
    fittedRef.current = next;
    setFitted(next);
  };

  const finishNow = useRef<() => void>(() => undefined);
  finishNow.current = () => {
    if (closed.current || !mounted.current) return;
    const current = editorRef.current;
    const start = baseline.current;
    if (!current || !start) return;
    closed.current = true;
    measure.current();
    const next = paragraphsToCommit(start, current.getJSON());
    if (next) onCommitRef.current(next, grownBox());
    onCloseRef.current();
  };
  const editor = useEditor({
    extensions,
    content: paragraphsToDoc(element.paragraphs),
    injectCSS: true,
    enablePasteRules: false,
    // Поле создаётся после монтирования, как Tiptap и делает под Next; явно — без предупреждения
    // в консоли на каждое открытие набора.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        'aria-label': t('editText'),
        'aria-multiline': 'true',
      },
      // Сочетания из общего реестра: Esc выходит из набора в выделение объекта, Ctrl+B/I/U,
      // выравнивание и кегль правят фрагмент, Tab и Shift+Tab — уровень пункта списка.
      // Остальное — Tiptap и браузеру.
      handleKeyDown: (_view, event) => {
        if (event.isComposing) return false;
        const command = editorCommand(event, 'text');
        if (!command) return false;
        if (command.kind === 'text-exit') {
          event.preventDefault();
          finishNow.current();
          return true;
        }
        // Tab в тексте без уровней ничего не делает, но и фокус из набора не уводит.
        if (command.kind === 'text-indent' && !keys.current.indentable) {
          event.preventDefault();
          return true;
        }
        const current = editorRef.current;
        if (!current) return false;
        const { inherited, ladder } = keys.current;
        if (!runTextCommand(current, command, inherited, ladder)) return false;
        event.preventDefault();
        return true;
      },
      // Строки буфера — отдельные абзацы; из Word и Google Docs — с жирным, курсивом и
      // подчёркиванием, остальное — от стиля рамки.
      handlePaste: (view, event) => pasteText(view, event, parseClipboardHtml),
    },
    onBlur: () => {
      if (!ready.current) return;
      const scheduled = epoch.current;
      window.setTimeout(() => {
        if (epoch.current !== scheduled || !mounted.current || closed.current) return;
        if (editorHasFocus(editorRef.current) || focusKept()) return;
        finishNow.current();
      }, 0);
    },
  });
  editorRef.current = editor;
  if (editor && baseline.current === null) baseline.current = editor.getJSON();

  useEffect(() => {
    const token = epoch.current + 1;
    epoch.current = token;
    mounted.current = true;
    return () => {
      mounted.current = false;
      ready.current = false;
      const current = editorRef.current;
      const start = baseline.current;
      if (!current || !start || closed.current) return;
      const next = paragraphsToCommit(start, current.getJSON());
      const box = grownBoxRef.current();
      window.setTimeout(() => {
        if (epoch.current !== token || mounted.current || closed.current) return;
        closed.current = true;
        if (next) onCommitRef.current(next, box);
        onCloseRef.current();
      }, 0);
    };
  }, []);

  const originX = origin?.x ?? null;
  const originY = origin?.y ?? null;
  // Символ, с которого начали печатать, вставляется один раз на редактор: StrictMode зовёт
  // эффект дважды, а второй раз символ задвоил бы.
  const typedInto = useRef<Editor | null>(null);
  useEffect(() => {
    if (!editor) return;
    const first = typed && typedInto.current !== editor ? typed : null;
    typedInto.current = editor;
    const point = originX == null || originY == null ? null : { x: originX, y: originY };
    if (first || !typed) placeCaret(editor, point, first);
    else editor.commands.focus(null, { scrollIntoView: false });
    const frameId = window.requestAnimationFrame(() => {
      ready.current = true;
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [editor, originX, originY, typed]);

  // Рамка по тексту: после каждой правки, при смене ширины поля и когда догрузился шрифт.
  useEffect(() => {
    if (!editor) return;
    const run = () => measure.current();
    run();
    editor.on('update', run);
    const observer = new ResizeObserver(run);
    observer.observe(editor.view.dom);
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) run();
    });
    return () => {
      alive = false;
      editor.off('update', run);
      observer.disconnect();
    };
  }, [editor, base, fit, slide.cx, slideRoot]);

  // Панель «Дизайн» правит выделенный фрагмент через этот редактор.
  useEffect(() => {
    if (!editor) return;
    setActiveTextEditor({ editor, elementId: element.elementId });
    return () => clearActiveTextEditor(editor);
  }, [editor, element.elementId]);

  // Фокус ушёл из поля в панель или меню, а оттуда — куда-то ещё: набор закончен.
  useEffect(() => {
    if (!editor) return;
    const onFocusIn = (event: FocusEvent) => {
      if (!ready.current || closed.current) return;
      const target = event.target;
      if (!(target instanceof Node) || editor.view.dom.contains(target)) return;
      if (target instanceof Element && target.closest(KEEPS_TEXT_FOCUS)) return;
      finishNow.current();
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [editor]);

  useEffect(() => {
    if (!finishRef) return;
    const finish = () => finishNow.current();
    finishRef.current = finish;
    return () => {
      if (finishRef.current === finish) finishRef.current = null;
    };
  }, [finishRef]);

  return createPortal(
    <>
      <style>{EDITOR_CSS}</style>
      <style>{hiddenSourceCss(element.elementId, shape !== undefined)}</style>
      {editor ? (
        <TextFormatBar editor={editor} element={element} profile={profile} inherited={look} />
      ) : null}
      <EditorContent
        editor={editor}
        data-text-editor=""
        data-bullets={bullets ? 'true' : 'false'}
        data-in-shape={shape ? '' : undefined}
        data-overflow={fitted.overflow ? 'true' : 'false'}
        style={{
          ...boxStyle(fitted.box, slide),
          zIndex: 2,
          overflow: 'visible',
          lineHeight: look.lineHeight,
          fontFamily: look.fontFamily,
          fontWeight: look.bold ? 700 : 400,
          fontStyle: look.italic ? 'italic' : 'normal',
          fontSize: cqw(ptToCqw(look.sizePt, slide)),
          color: look.color,
          cursor: 'text',
          ...shape?.style,
        }}
      />
      {fitted.overflow ? (
        // Рамка шаблона не растёт: значок в её углу, как у переполнения от движка.
        <div
          data-text-overflow=""
          className="pointer-events-none"
          style={{ ...boxStyle(fitted.box, slide), zIndex: 3 }}
        >
          <span
            aria-hidden
            title={t('textOverflow')}
            className="absolute right-0 bottom-0 grid size-4 translate-x-1/2 translate-y-1/2 place-items-center rounded-full bg-[var(--canvas-snap)] text-[10px] leading-none font-bold text-background"
          >
            !
          </span>
          <span role="status" className="sr-only">
            {t('textOverflow')}
          </span>
        </div>
      ) : null}
    </>,
    slideRoot,
  );
}
