'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { Editor } from '@tiptap/core';
import { useEditorState, type EditorStateSnapshot } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import type { DesignSystem } from '@lct/contracts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  ariaKeyShortcuts,
  isMacPlatform,
  shortcutText,
  type ShortcutId,
} from '@/components/editor/editor-shortcuts';
import type { TextFlag } from '@/components/editor/editor-keymap';
import {
  rangeFlagOn,
  toggleRangeFlag,
  type InheritedText,
} from '@/components/editor/text-shortcuts';

/*
 * BubbleMenu пересылает плагину свои опции транзакцией всякий раз, когда меняется ссылка на
 * `shouldShow`, `appendTo` или `options`. Инлайн-значения менялись бы на каждом рендере, а
 * рендер шёл от транзакции, — отсюда бесконечный цикл. Поэтому все три живут в модуле.
 */
const ALWAYS_SHOW = () => true;
const APPEND_TO_BODY = () => document.body;
const MENU_OPTIONS = { placement: 'top', offset: 8 } as const;

function preventFocusLoss(event: { preventDefault: () => void }) {
  event.preventDefault();
}

/**
 * Метки набора: жирный, курсив, шрифт и цвет роли. В журнал колоды они попадут одним
 * `set-text`, когда поле закроется. `mousedown` не отдаёт фокус, иначе поле решит, что набор
 * кончился, ещё до команды.
 */
export function TextFormatBar({
  editor,
  profile,
  inherited,
}: {
  editor: Editor;
  profile: DesignSystem;
  /** Начертание роли: жирный заголовок нажат, пока его не сняли. */
  inherited: InheritedText;
}) {
  const t = useTranslations('formatBar');
  const style = useTranslations('selectionBar');
  // Только то, что рисует полоса: перерисовка — когда меняются эти флаги, а не на каждую
  // транзакцию. Флаги — с учётом роли, как у Ctrl+B/I/U.
  const marks = useEditorState({
    editor,
    selector: ({ editor: current }: EditorStateSnapshot<Editor>) => ({
      bold: rangeFlagOn(current, 'bold', inherited),
      italic: rangeFlagOn(current, 'italic', inherited),
      underline: rangeFlagOn(current, 'underline', inherited),
    }),
  });
  const toggle = (flag: TextFlag) => toggleRangeFlag(editor, flag, inherited);

  const fonts = [...new Set(profile.typeScale.map((entry) => entry.font).filter(Boolean))];
  const sizes = profile.typeScale.filter(
    (entry, index, all) => all.findIndex((other) => other.role === entry.role) === index,
  );

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={ALWAYS_SHOW}
      appendTo={APPEND_TO_BODY}
      options={MENU_OPTIONS}
      data-text-format=""
      role="toolbar"
      aria-label={t('label')}
      onMouseDown={preventFocusLoss}
      className="z-[4000] flex items-center gap-0.5 rounded-xl bg-card p-1 shadow-lg ring-1 shadow-black/25 ring-border"
    >
      <FormatButton
        label={t('bold')}
        shortcut="bold"
        pressed={marks.bold}
        strong
        onClick={() => toggle('bold')}
      >
        B
      </FormatButton>
      <FormatButton
        label={t('italic')}
        shortcut="italic"
        pressed={marks.italic}
        italic
        onClick={() => toggle('italic')}
      >
        I
      </FormatButton>
      <FormatButton
        label={t('underline')}
        shortcut="underline"
        pressed={marks.underline}
        underline
        onClick={() => toggle('underline')}
      >
        U
      </FormatButton>
      <MenuButton label={t('font')}>
        {fonts.map((font) => (
          <DropdownMenuItem
            key={font}
            onMouseDown={preventFocusLoss}
            onSelect={() => editor.chain().focus().setFontFamily(font).run()}
          >
            <span style={{ fontFamily: `"${font.replaceAll('"', '')}"` }}>{font}</span>
          </DropdownMenuItem>
        ))}
      </MenuButton>
      <MenuButton label={style('size')}>
        {sizes.map((entry) => (
          <DropdownMenuItem
            key={entry.role}
            onMouseDown={preventFocusLoss}
            onSelect={() => editor.chain().focus().setFontSize(String(entry.sizePt)).run()}
          >
            {style(`type.${entry.role as TypeRoleKey}`)}
            <span className="ml-auto pl-3 text-muted-foreground tabular-nums">{entry.sizePt}</span>
          </DropdownMenuItem>
        ))}
      </MenuButton>
      <MenuButton label={style('color')}>
        {profile.palette.map((entry) => (
          <DropdownMenuItem
            key={entry.role}
            onMouseDown={preventFocusLoss}
            onSelect={() => editor.chain().focus().setColor(`#${entry.hex}`).run()}
          >
            <Swatch hex={entry.hex} />
            {style(`palette.${entry.role}`)}
          </DropdownMenuItem>
        ))}
      </MenuButton>
    </BubbleMenu>
  );
}

type TypeRoleKey =
  | 'title'
  | 'subtitle'
  | 'heading'
  | 'body'
  | 'bullet'
  | 'caption'
  | 'kpi-value'
  | 'kpi-caption'
  | 'quote'
  | 'footer';

function FormatButton({
  label,
  pressed,
  strong,
  italic,
  underline,
  shortcut,
  onClick,
  children,
}: {
  label: string;
  /** Сочетание из общего реестра: в подсказке и в `aria-keyshortcuts`. */
  shortcut: ShortcutId;
  pressed: boolean;
  strong?: boolean;
  italic?: boolean;
  underline?: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-keyshortcuts={ariaKeyShortcuts(shortcut)}
      title={`${label} (${shortcutText(shortcut, isMacPlatform())})`}
      aria-pressed={pressed}
      onMouseDown={preventFocusLoss}
      onClick={onClick}
      className={cn(
        'grid size-8 place-items-center rounded-lg text-sm outline-none',
        'hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50',
        pressed ? 'bg-muted text-foreground' : 'text-muted-foreground',
        strong && 'font-semibold',
        italic && 'italic',
        underline && 'underline',
      )}
    >
      {children}
    </button>
  );
}

function MenuButton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onMouseDown={preventFocusLoss}
          className={cn(
            'h-8 rounded-lg px-2 text-xs text-muted-foreground outline-none',
            'hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
          )}
        >
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="z-[4000] min-w-44">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

function Swatch({ hex }: { hex: string }) {
  return (
    <span
      aria-hidden
      className="size-3 shrink-0 rounded-full ring-1 ring-foreground/20"
      style={{ background: `#${hex}` }}
    />
  );
}
