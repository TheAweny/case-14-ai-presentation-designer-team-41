'use client';

import { useRef, useState } from 'react';
import { ChevronDownIcon, type Icon } from '@/components/ui/icons';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatNumber } from '@/components/editor/inspector/number-input';
import { useFocusReturn } from '@/components/editor/inspector/fields/field-chrome';
import { NumberField } from '@/components/editor/inspector/fields/number-field';

/** Вариант из списка: число или «не задано» (`null`), с подписью и пояснением справа. */
export interface NumberPreset {
  readonly value: number | null;
  /** Что написать вместо числа («Авто»). По умолчанию — само число с суффиксом поля. */
  readonly label?: string;
  /** Пояснение справа, приглушённо: роль кегля в шаблоне («Заголовок»). */
  readonly hint?: string;
}

/**
 * Какой вариант отметить галочкой: первый совпадающий со значением, иначе никакой. Ключ —
 * номер варианта: в шкале шаблона у разных ролей бывает один кегль.
 */
function selectedPresetKey(presets: readonly NumberPreset[], value: number | null | undefined) {
  if (value === undefined) return '';
  const index = presets.findIndex((preset) =>
    value === null || preset.value === null
      ? preset.value === value
      : Math.abs(preset.value - value) < 1e-9,
  );
  return index < 0 ? '' : String(index);
}

/**
 * Числовое поле со списком вариантов, как кегль в Figma: вводить можно любое значение,
 * шеврон открывает частые. `value`: число; `null` — «не задано» (поле показывает
 * `unsetLabel`, например «Авто»); `undefined` — у выделенных значения разные.
 */
export function NumberCombobox({
  label,
  icon,
  value,
  presets,
  onCommit,
  onCommitEach,
  onPreview,
  onPreviewEach,
  onPreviewEnd,
  step,
  min,
  max,
  precision,
  suffix,
  unsetLabel,
  mixedLabel,
  ariaLabel,
  presetsLabel,
  disabled,
}: {
  label?: string;
  icon?: Icon;
  value: number | null | undefined;
  presets: readonly NumberPreset[];
  onCommit: (value: number | null) => void;
  onCommitEach?: (apply: (old: number) => number) => void;
  onPreview?: (value: number) => void;
  onPreviewEach?: (apply: (old: number) => number) => void;
  onPreviewEnd?: () => void;
  step?: number;
  min?: number;
  max?: number;
  precision?: number;
  suffix?: string;
  /** Подпись «не задано». Без неё очистка поля не применяется, а просто откатывает ввод. */
  unsetLabel?: string;
  mixedLabel: string;
  ariaLabel: string;
  /** Подпись кнопки списка для экранного диктора. */
  presetsLabel: string;
  disabled?: boolean;
}) {
  const field = useRef<HTMLLabelElement>(null);
  const [width, setWidth] = useState<number | undefined>(undefined);
  const focus = useFocusReturn({ focusOnOpen: true });

  const selectedKey = selectedPresetKey(presets, value);

  const trailing = (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (open) setWidth(field.current?.offsetWidth);
      }}
    >
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={presetsLabel}
          title={presetsLabel}
          {...focus.trigger}
          className={cn(
            '-mr-1 grid size-5 shrink-0 place-items-center rounded text-muted-foreground outline-none',
            'hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
            'data-[state=open]:bg-foreground/10 data-[state=open]:text-foreground',
          )}
        >
          <ChevronDownIcon size={12} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-inspector-popover=""
        align="end"
        alignOffset={-8}
        sideOffset={6}
        style={{ minWidth: width }}
        className="w-auto"
        onCloseAutoFocus={focus.content.onCloseAutoFocus}
        onInteractOutside={focus.content.onInteractOutside}
      >
        <DropdownMenuRadioGroup
          value={selectedKey}
          onValueChange={(key) => {
            const preset = presets[Number(key)];
            if (!preset) return;
            if (preset.value === value) return;
            onCommit(preset.value);
          }}
        >
          {presets.map((preset, index) => (
            <DropdownMenuRadioItem key={index} value={String(index)} className="gap-4">
              <span className="tabular-nums">
                {preset.label ??
                  (preset.value === null
                    ? unsetLabel
                    : `${formatNumber(preset.value, precision)}${suffix ? ` ${suffix}` : ''}`)}
              </span>
              {preset.hint ? (
                <span className="ml-auto truncate text-muted-foreground">{preset.hint}</span>
              ) : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <NumberField
      fieldRef={field}
      label={label}
      icon={icon}
      value={typeof value === 'number' ? value : null}
      onCommit={onCommit}
      onCommitEach={value === undefined ? onCommitEach : undefined}
      onPreview={onPreview}
      onPreviewEach={onPreviewEach}
      onPreviewEnd={onPreviewEnd}
      step={step}
      min={min}
      max={max}
      precision={precision}
      suffix={suffix}
      mixedLabel={value === null ? (unsetLabel ?? mixedLabel) : mixedLabel}
      ariaLabel={ariaLabel}
      disabled={disabled}
      onClear={unsetLabel && value !== null ? () => onCommit(null) : undefined}
      trailing={trailing}
    />
  );
}
