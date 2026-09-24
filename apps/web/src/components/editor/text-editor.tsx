'use client';

import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  KEEPS_TEXT_FOCUS,
  clearActiveTextEditor,
  setActiveTextEditor,
} from '@/components/editor/active-text-editor';
import { useTranslations } from 'next-intl';
import type { Editor, JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import type { DesignSystem, Paragraph, SlideElement } from '@lct/contracts';
import {
  boxStyle,
  cqw,
  createTypeResolver,
  EMU_PER_PT,
  fontFamily,
  paint,
  ptToCqw,
  typeRoleOf,
  type SlideSize,
} from '@lct/slide-renderer';
import {
  paragraphsToCommit,
  paragraphsToDoc,
  pasteAsPlainText,
  textExtensions,
} from '@/components/editor/text-document';
import { TextFormatBar } from '@/components/editor/text-format';
import { editorCommand } from '@/components/editor/editor-keymap';
import { runTextCommand, sizeLadder, type InheritedText } from '@/components/editor/text-shortcuts';

type TextElement = Extract<SlideElement, { kind: 'text' }>;

const EDITOR_CSS = `
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
    lineHeight: type.lineSpacing(element.role),
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

function placeCaret(editor: Editor, origin: { readonly x: number; readonly y: number } | null) {
  try {
    if (origin) {
      const coords = editor.view.posAtCoords({ left: origin.x, top: origin.y });
      if (coords) editor.commands.setTextSelection(coords.pos);
    } else {
      // Вход с клавиатуры (Enter), как в Figma и PowerPoint: выделен весь текст.
      editor.commands.selectAll();
    }
    editor.commands.focus(null, { scrollIntoView: false });
  } catch {
    editor.commands.focus('end', { scrollIntoView: false });
  }
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
 * а `style` ставит поле внутрь её полей и по её якорю.
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
  /**
   * Сюда поле кладёт своё закрытие: холст зовёт его по клику мимо поля и при смене выделения.
   * Mousedown у Selecto не отдаёт фокус, так что одного blur для этого мало.
   */
  finishRef?: { current: (() => void) | null };
  onCommit: (paragraphs: readonly Paragraph[]) => void;
  onClose: () => void;
  /** Текст в фигуре, а не текстовый блок: см. `ShapeTextFrame`. */
  shape?: ShapeTextFrame;
}) {
  const t = useTranslations('editor');
  const look = shape?.look ?? inheritedLook(profile, element, slide.cy);
  const bullets = element.role === 'bullet-list';
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
  const keys = useRef<{ inherited: InheritedText; ladder: readonly number[] }>({
    inherited: look,
    ladder: [],
  });
  keys.current = { inherited: look, ladder: sizeLadder(profile) };

  const finishNow = useRef<() => void>(() => undefined);
  finishNow.current = () => {
    if (closed.current || !mounted.current) return;
    const current = editorRef.current;
    const base = baseline.current;
    if (!current || !base) return;
    closed.current = true;
    const next = paragraphsToCommit(base, current.getJSON());
    if (next) onCommitRef.current(next);
    onCloseRef.current();
  };
  const editor = useEditor({
    extensions,
    content: paragraphsToDoc(element.paragraphs),
    injectCSS: true,
    enablePasteRules: false,
    editorProps: {
      attributes: {
        'aria-label': t('editText'),
        'aria-multiline': 'true',
      },
      // Сочетания из общего реестра: Esc выходит из набора в выделение объекта, Ctrl+B/I/U,
      // выравнивание и кегль правят фрагмент. Остальное — Tiptap и браузеру.
      handleKeyDown: (_view, event) => {
        if (event.isComposing) return false;
        const command = editorCommand(event, 'text');
        if (!command) return false;
        if (command.kind === 'text-exit') {
          event.preventDefault();
          finishNow.current();
          return true;
        }
        const current = editorRef.current;
        if (!current) return false;
        const { inherited, ladder } = keys.current;
        if (!runTextCommand(current, command, inherited, ladder)) return false;
        event.preventDefault();
        return true;
      },
      handlePaste: (view, event) => pasteAsPlainText(view, event),
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
      const base = baseline.current;
      if (!current || !base || closed.current) return;
      const next = paragraphsToCommit(base, current.getJSON());
      window.setTimeout(() => {
        if (epoch.current !== token || mounted.current || closed.current) return;
        closed.current = true;
        if (next) onCommitRef.current(next);
        onCloseRef.current();
      }, 0);
    };
  }, []);

  const originX = origin?.x ?? null;
  const originY = origin?.y ?? null;
  useEffect(() => {
    if (!editor) return;
    placeCaret(editor, originX == null || originY == null ? null : { x: originX, y: originY });
    const frameId = window.requestAnimationFrame(() => {
      ready.current = true;
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [editor, originX, originY]);

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
      {editor ? <TextFormatBar editor={editor} profile={profile} inherited={look} /> : null}
      <EditorContent
        editor={editor}
        data-text-editor=""
        data-bullets={bullets ? 'true' : 'false'}
        data-in-shape={shape ? '' : undefined}
        style={{
          ...boxStyle(element.box, slide),
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
    </>,
    slideRoot,
  );
}
