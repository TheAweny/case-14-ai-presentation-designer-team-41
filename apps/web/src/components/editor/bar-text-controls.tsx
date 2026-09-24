'use client';

import { useContext } from 'react';
import { useTranslations } from 'next-intl';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  AlignBottomIcon,
  AlignTopIcon,
  AlignVerticalCenterIcon,
  MinusSignIcon,
  PlusSignIcon,
  TextAlignCenterIcon,
  TextAlignJustifyLeftIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
  TextBoldIcon,
  TextItalicIcon,
  TextUnderlineIcon,
} from '@hugeicons/core-free-icons';
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
} from '@/components/ui/dropdown-menu';
import { ColorField, FontPicker, NumberCombobox } from '@/components/editor/inspector/controls';
import { colorHex } from '@/components/editor/inspector/fields/color';
import { templateFonts, typeSteps, type TextLook } from '@/components/editor/inspector/text-model';
import type { EditMode } from '@/components/editor/use-deck-history';
import { BAR_SHORTCUTS, stepFontSize } from '@/components/editor/selection-bar-model';
import { BarButton, BarItem, BarMenu, BarSideContext } from '@/components/editor/bar-controls';

const TEXT_ALIGNS = [
  { value: 'left', icon: TextAlignLeftIcon },
  { value: 'center', icon: TextAlignCenterIcon },
  { value: 'right', icon: TextAlignRightIcon },
  { value: 'justify', icon: TextAlignJustifyLeftIcon },
] as const satisfies readonly { value: ParagraphAlign; icon: unknown }[];

const VERTICAL_ALIGNS = [
  { value: 'top', icon: AlignTopIcon },
  { value: 'middle', icon: AlignVerticalCenterIcon },
  { value: 'bottom', icon: AlignBottomIcon },
] as const satisfies readonly { value: VerticalAlign; icon: unknown }[];

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
  /** «−» и «+» при разных кеглях: каждому от своего. Без неё кнопки при разных неактивны. */
  stepSize?(direction: 1 | -1): void;
  setFlag(flag: 'bold' | 'italic' | 'underline', on: boolean): void;
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
  const step = (direction: 1 | -1) => {
    if (look.sizePt !== null) actions.setSize(stepFontSize(look.sizePt, direction));
    else actions.stepSize?.(direction);
  };
  const canStep = look.sizePt !== null || actions.stepSize !== undefined;
  const align = TEXT_ALIGNS.find((option) => option.value === look.align) ?? TEXT_ALIGNS[0];
  const flag = (name: 'bold' | 'italic' | 'underline', on: boolean | null) =>
    actions.setFlag(name, on !== true);

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
          icon={MinusSignIcon}
          label={t('smaller')}
          disabled={!canStep || look.sizePt === FONT_SIZE_PT.min}
          onClick={() => step(-1)}
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
          icon={PlusSignIcon}
          label={t('larger')}
          disabled={!canStep || look.sizePt === FONT_SIZE_PT.max}
          onClick={() => step(1)}
          className="min-w-6 px-0.5"
        />
      </div>
      <BarButton
        icon={TextBoldIcon}
        label={t('bold')}
        keys={BAR_SHORTCUTS.bold}
        pressed={look.bold === true}
        onClick={() => flag('bold', look.bold)}
      />
      <BarButton
        icon={TextItalicIcon}
        label={t('italic')}
        keys={BAR_SHORTCUTS.italic}
        pressed={look.italic === true}
        onClick={() => flag('italic', look.italic)}
      />
      <BarButton
        icon={TextUnderlineIcon}
        label={panel('underline')}
        keys={BAR_SHORTCUTS.underline}
        pressed={look.underline}
        onClick={() => flag('underline', look.underline)}
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
                  <HugeiconsIcon icon={option.icon} strokeWidth={1.5} color="currentColor" />
                  {panel(`textAligns.${option.value}`)}
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
                      <HugeiconsIcon icon={option.icon} strokeWidth={1.5} color="currentColor" />
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
