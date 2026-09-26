'use client';

import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon } from '@hugeicons/core-free-icons';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FIELD_CLASS, useFocusReturn } from '@/components/editor/inspector/fields/field-chrome';
import { fontFamilyCss } from '@/components/editor/inspector/fields/fonts';
import {
  FONT_STYLES,
  fontStyleFlags,
  fontStyleOf,
  type FontStyle,
} from '@/components/editor/inspector/fields/font-style';

export type { FontStyle };

export interface SelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** Как нарисовать подпись варианта (начертание — самим начертанием). */
  readonly style?: CSSProperties;
}

/**
 * Компактный выбор из списка в виде поля панели. `value === null` — у выделенных разные
 * значения: поле показывает `placeholder`.
 */
export function SelectField<T extends string>({
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
  disabled,
}: {
  value: T | null;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder: string;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const focus = useFocusReturn({ focusOnOpen: true });
  const current = options.find((option) => option.value === value) ?? null;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={ariaLabel}
          title={ariaLabel}
          {...focus.trigger}
          className={cn(
            FIELD_CLASS,
            'w-full text-left outline-none focus-visible:ring-ring data-[state=open]:ring-ring',
            disabled && 'pointer-events-none opacity-50',
          )}
        >
          <span
            className={cn(
              'min-w-0 flex-1 truncate',
              current ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {current?.label ?? placeholder}
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={12}
            strokeWidth={2}
            color="currentColor"
            className="shrink-0 text-muted-foreground"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-inspector-popover=""
        align="start"
        className="min-w-40"
        onCloseAutoFocus={focus.content.onCloseAutoFocus}
        onInteractOutside={focus.content.onInteractOutside}
      >
        <DropdownMenuRadioGroup
          value={value ?? ''}
          onValueChange={(next) => {
            const found = options.find((option) => option.value === next);
            if (found && found.value !== value) onChange(found.value);
          }}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <span style={option.style}>{option.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Начертание как в Figma: Regular / Italic / Bold / Bold Italic поверх флагов `bold` и
 * `italic`. `null` у флага — у выделенного он разный, тогда и начертание «разное».
 */
export function FontStyleField({
  bold,
  italic,
  onChange,
  fontFamily,
  mixedLabel,
  disabled,
}: {
  bold: boolean | null;
  italic: boolean | null;
  onChange: (flags: { bold: boolean; italic: boolean }) => void;
  /** Семейство для превью вариантов; без него — шрифт интерфейса. */
  fontFamily?: string;
  /** Подпись «разные»; по умолчанию общая «Разные». */
  mixedLabel?: string;
  disabled?: boolean;
}) {
  const t = useTranslations('inspectorFields');
  const options = FONT_STYLES.map((style) => {
    const flags = fontStyleFlags(style);
    return {
      value: style,
      label: t(`fontStyle.${style}`),
      style: {
        fontWeight: flags.bold ? 700 : 400,
        fontStyle: flags.italic ? 'italic' : 'normal',
        fontFamily: fontFamily ? fontFamilyCss(fontFamily) : undefined,
      },
    } satisfies SelectOption<FontStyle>;
  });

  return (
    <SelectField
      value={fontStyleOf(bold, italic)}
      options={options}
      onChange={(style) => onChange(fontStyleFlags(style))}
      placeholder={mixedLabel ?? t('mixed')}
      ariaLabel={t('fontStyle.label')}
      disabled={disabled}
    />
  );
}
