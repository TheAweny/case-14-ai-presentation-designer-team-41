'use client';

import { useContext } from 'react';
import { useTranslations } from 'next-intl';
import {
  AlignBottomIcon,
  AlignMiddleIcon,
  AlignTopIcon,
  BoldIcon,
  ItalicIcon,
  MinusIcon,
  PlusIcon,
  TextAlignCenterIcon,
  TextAlignJustifyIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
  UnderlineIcon,
  type Icon,
} from '@/components/ui/icons';
import type {
  ColorRole,
  ColorValue,
  DesignSystem,
  ParagraphAlign,
  TypeRole,
  VerticalAlign,
} from '@lct/contracts';
import { FONT_SIZE_PT } from '@lct/deck-ops';
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu';
import { ColorField, FontPicker, NumberCombobox } from '@/components/editor/inspector/controls';
import { colorHex } from '@/components/editor/inspector/fields/color';
import { templateFonts, typeSteps, type TextLook } from '@/components/editor/inspector/text-model';
import type { EditMode } from '@/components/editor/use-deck-history';
import type { TextFlag } from '@/components/editor/editor-keymap';
import type { ShortcutId } from '@/components/editor/editor-shortcuts';
import {
  BarButton,
  BarItem,
  BarMenu,
  BarSideContext,
  ShortcutKeys,
} from '@/components/editor/bar-controls';

const TEXT_ALIGNS = [
  { value: 'left', icon: TextAlignLeftIcon, shortcut: 'align-left' },
  { value: 'center', icon: TextAlignCenterIcon, shortcut: 'align-center' },
  { value: 'right', icon: TextAlignRightIcon, shortcut: 'align-right' },
  { value: 'justify', icon: TextAlignJustifyIcon, shortcut: 'align-justify' },
] as const satisfies readonly { value: ParagraphAlign; icon: Icon; shortcut: ShortcutId }[];

const VERTICAL_ALIGNS = [
  { value: 'top', icon: AlignTopIcon },
  { value: 'middle', icon: AlignMiddleIcon },
  { value: 'bottom', icon: AlignBottomIcon },
] as const satisfies readonly { value: VerticalAlign; icon: Icon }[];

/**
 * Что умеют текстовые контролы полосы. Одинаково для целого блока (правки в журнал) и для
 * выделенного фрагмента в открытом наборе (правки в набор, в журнал — когда он закроется).
 */
export interface TextBarActions {
  readonly look: TextLook;
  /** Живой вид цвета, пока тянут в пикере: только у целого блока, набор правится сразу. */
  readonly live: boolean;
  setFont(family: string | null): void;
  setSize(sizePt: number): void;
  /** «−» и «+» — ступень шкалы шаблона, как Ctrl+Shift+< и Ctrl+Shift+>. */
  stepSize(step: -1 | 1): void;
  /** Как Ctrl+B/I/U: всё уже с флагом — снять, иначе поставить; начертание роли учтено. */
  toggleFlag(flag: TextFlag): void;
  setColor(color: ColorValue, hex: string, mode: EditMode): void;
  setAlign(align: ParagraphAlign): void;
  /** Вертикальная привязка — свойство рамки. В наборе её нет. */
  setVerticalAlign?(align: VerticalAlign): void;
  onPreviewEnd(): void;
}

/**
 * Типографика в полосе, как у Google Slides: шрифт, кегль с «−» и «+», B/I/U, цвет и
 * выравнивание. Шрифты и кегли шаблона — первыми, свой можно ввести.
 */
export function TextBarControls({
  designSystem,
  actions,
}: {
  designSystem: DesignSystem;
  actions: TextBarActions;
}) {
  const t = useTranslations('selectionBar');
  const panel = useTranslations('designPanel');
  const scale = useTranslations('selectionBar.type');
  const palette = useTranslations('selectionBar.palette');
  const side = useContext(BarSideContext);
  const { look } = actions;
  const mixed = panel('mixed');
  const align = TEXT_ALIGNS.find((option) => option.value === look.align) ?? TEXT_ALIGNS[0];

  return (
    <>
      <BarItem label={panel('font')} className="w-28">
        <FontPicker
          ariaLabel={panel('font')}
          value={look.font}
          templateFonts={templateFonts(designSystem)}
          placeholder={mixed}
          resetLabel={panel('templateFont')}
          onChange={actions.setFont}
        />
      </BarItem>
      <div role="group" aria-label={panel('fontSize')} className="flex items-center">
        <BarButton
          icon={MinusIcon}
          label={t('smaller')}
          shortcut="size-down"
          disabled={look.sizePt === FONT_SIZE_PT.min}
          onClick={() => actions.stepSize(-1)}
          className="min-w-6 px-0.5"
        />
        <BarItem label={panel('fontSize')} className="w-[4.75rem]">
          <NumberCombobox
            ariaLabel={panel('fontSize')}
            presetsLabel={panel('fontSizePresets')}
            mixedLabel={mixed}
            value={look.sizePt ?? undefined}
            presets={typeSteps(designSystem).map((entry) => ({
              value: entry.sizePt,
              hint: scale(entry.role as TypeRole),
            }))}
            min={FONT_SIZE_PT.min}
            max={FONT_SIZE_PT.max}
            onCommit={(value) => {
              if (value !== null) actions.setSize(value);
            }}
          />
        </BarItem>
        <BarButton
          icon={PlusIcon}
          label={t('larger')}
          shortcut="size-up"
          disabled={look.sizePt === FONT_SIZE_PT.max}
          onClick={() => actions.stepSize(1)}
          className="min-w-6 px-0.5"
        />
      </div>
      <BarButton
        icon={BoldIcon}
        label={t('bold')}
        shortcut="bold"
        pressed={look.bold === true}
        onClick={() => actions.toggleFlag('bold')}
      />
      <BarButton
        icon={ItalicIcon}
        label={t('italic')}
        shortcut="italic"
        pressed={look.italic === true}
        onClick={() => actions.toggleFlag('italic')}
      />
      <BarButton
        icon={UnderlineIcon}
        label={panel('underline')}
        shortcut="underline"
        pressed={look.underline}
        onClick={() => actions.toggleFlag('underline')}
      />
      <BarItem label={panel('textColor')}>
        <ColorField
          variant="swatch"
          side={side}
          ariaLabel={panel('textColor')}
          palette={designSystem.palette}
          value={look.color ?? undefined}
          mixedLabel={mixed}
          roleLabel={(role: ColorRole) => palette(role)}
          renderSwatch={({ hex, mixed: differs }) => (
            <span className="flex flex-col items-center leading-none">
              <span className="text-sm font-semibold text-foreground">A</span>
              <span
                aria-hidden
                className="mt-0.5 h-1 w-4 rounded-full ring-1 ring-foreground/20"
                style={{ background: hex && !differs ? `#${hex}` : 'transparent' }}
              />
            </span>
          )}
          onChange={(value) => {
            const hex = value === null ? null : colorHex(designSystem.palette, value);
            if (value !== null && hex !== null) actions.setColor(value, hex, 'commit');
          }}
          onPreview={(hex) => actions.setColor(hex, hex, actions.live ? 'preview' : 'commit')}
          onPreviewEnd={actions.live ? actions.onPreviewEnd : undefined}
        />
      </BarItem>
      <BarMenu
        icon={align.icon}
        label={panel('textAlign')}
        content={
          <>
            <DropdownMenuRadioGroup
              value={look.align ?? ''}
              onValueChange={(value) => {
                const found = TEXT_ALIGNS.find((option) => option.value === value);
                if (found) actions.setAlign(found.value);
              }}
            >
              {TEXT_ALIGNS.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  <option.icon />
                  {panel(`textAligns.${option.value}`)}
                  <DropdownMenuShortcut>
                    <ShortcutKeys shortcut={option.shortcut} />
                  </DropdownMenuShortcut>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {actions.setVerticalAlign ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{panel('verticalAlign')}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={look.verticalAlign ?? ''}
                  onValueChange={(value) => {
                    const found = VERTICAL_ALIGNS.find((option) => option.value === value);
                    if (found) actions.setVerticalAlign?.(found.value);
                  }}
                >
                  {VERTICAL_ALIGNS.map((option) => (
                    <DropdownMenuRadioItem key={option.value} value={option.value}>
                      <option.icon />
                      {panel(`verticalAligns.${option.value}`)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </>
            ) : null}
          </>
        }
      />
    </>
  );
}
