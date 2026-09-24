'use client';

import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import type { ColorRole, PaletteEntry } from '@lct/contracts';
import { cn } from '@/lib/utils';
import { parseNumber, stepNumber } from '@/components/editor/inspector/number-input';

/** Секция панели: подпись сверху, под ней строки. Секции разделены тонкой линией, как в Figma. */
export function Section({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 border-b border-border px-3 py-3 last:border-b-0">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-foreground">{title}</h3>
        {actions ? <div className="flex items-center gap-0.5">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Строка из двух полей одинаковой ширины. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

/**
 * Числовое поле. Правка применяется целиком — по Enter или уходу из поля, Esc возвращает
 * прежнее значение. Стрелки меняют на шаг, с Shift — на десять шагов, и применяют сразу:
 * одно нажатие — одна запись в истории, как у стрелок на холсте.
 *
 * `value === null` значит «у выделенных объектов разные значения»: поле пустое, с подсказкой.
 */
export function NumberField({
  label,
  icon,
  value,
  onCommit,
  step = 1,
  min,
  max,
  suffix,
  mixedLabel,
  ariaLabel,
  disabled,
}: {
  label?: string;
  icon?: IconSvgElement;
  value: number | null;
  onCommit: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  mixedLabel: string;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const shown = value === null ? '' : formatNumber(value);
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? shown;

  const commit = (next: number | null) => {
    setDraft(null);
    if (next === null) return;
    const bounded = clamp(next, min, max);
    if (value !== null && Math.abs(bounded - value) < 1e-9) return;
    onCommit(bounded);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit(parseNumber(text));
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(null);
      event.currentTarget.blur();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const base = parseNumber(text) ?? value ?? 0;
      const direction = event.key === 'ArrowUp' ? 1 : -1;
      commit(stepNumber(base, step * (event.shiftKey ? 10 : 1) * direction));
    }
  };

  return (
    <label
      className={cn(
        'group/field flex h-7 min-w-0 items-center gap-1.5 rounded-md bg-muted/60 px-2 text-xs',
        'ring-1 ring-transparent transition-colors duration-100 motion-reduce:transition-none',
        'hover:ring-border focus-within:bg-background focus-within:ring-ring',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      {icon ? (
        <HugeiconsIcon
          icon={icon}
          size={13}
          strokeWidth={1.5}
          color="currentColor"
          className="shrink-0 text-muted-foreground"
        />
      ) : (
        <span className="w-3 shrink-0 text-center text-muted-foreground select-none">{label}</span>
      )}
      <input
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        disabled={disabled}
        value={text}
        placeholder={value === null ? mixedLabel : undefined}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={() => {
          if (draft !== null) commit(parseNumber(draft));
        }}
        onKeyDown={onKeyDown}
        className="min-w-0 flex-1 bg-transparent tabular-nums text-foreground outline-none placeholder:text-muted-foreground"
      />
      {suffix ? <span className="shrink-0 text-muted-foreground select-none">{suffix}</span> : null}
    </label>
  );
}

function clamp(value: number, min?: number, max?: number): number {
  let next = value;
  if (min !== undefined) next = Math.max(min, next);
  if (max !== undefined) next = Math.min(max, next);
  return next;
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Переключатель из нескольких вариантов, иконками. Пустое значение — «разные» или «не задано». */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T | null;
  options: readonly { value: T; label: string; icon: IconSvgElement }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      aria-label={ariaLabel}
      value={value ?? ''}
      onValueChange={(next) => {
        // Radix снимает выбор при повторном клике; у свойства всегда есть значение.
        const found = options.find((option) => option.value === next);
        if (found) onChange(found.value);
      }}
      className="flex h-7 items-center gap-0.5 rounded-md bg-muted/60 p-0.5"
    >
      {options.map((option) => (
        <ToggleGroupPrimitive.Item
          key={option.value}
          value={option.value}
          aria-label={option.label}
          title={option.label}
          className={cn(
            'grid h-6 flex-1 place-items-center rounded-[5px] text-muted-foreground outline-none',
            'transition-colors duration-100 motion-reduce:transition-none',
            'hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
            'data-[state=on]:bg-foreground/15 data-[state=on]:text-foreground',
          )}
        >
          <HugeiconsIcon icon={option.icon} size={14} strokeWidth={1.5} color="currentColor" />
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}

/** Квадратная кнопка-иконка для действий секции (слои, выравнивание, B/I/U). */
export function IconButton({
  icon,
  label,
  onClick,
  pressed,
  disabled,
}: {
  icon: IconSvgElement;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none',
        'transition-colors duration-100 motion-reduce:transition-none',
        'hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
        'disabled:pointer-events-none disabled:opacity-40',
        pressed && 'bg-foreground/15 text-foreground hover:bg-foreground/20',
      )}
    >
      <HugeiconsIcon icon={icon} size={15} strokeWidth={1.5} color="currentColor" />
    </button>
  );
}

/**
 * Цвета — только роли палитры шаблона: свой цвет в презентации не появляется. `value === undefined`
 * значит «у выделенных разные цвета», `null` — «без цвета» (если его можно выбрать).
 */
export function SwatchPicker({
  palette,
  value,
  onChange,
  roleLabel,
  noneLabel,
  ariaLabel,
}: {
  palette: readonly PaletteEntry[];
  value: ColorRole | null | undefined;
  onChange: (value: ColorRole | null) => void;
  roleLabel: (role: ColorRole) => string;
  /** Подпись «без цвета». Без неё этот вариант не показывается. */
  noneLabel?: string;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {noneLabel ? (
        <Swatch selected={value === null} label={noneLabel} onSelect={() => onChange(null)}>
          <span className="absolute inset-0 rounded-full bg-background" />
          <span className="absolute top-1/2 left-1/2 h-px w-[140%] -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-destructive" />
        </Swatch>
      ) : null}
      {palette.map((entry) => (
        <Swatch
          key={entry.role}
          selected={value === entry.role}
          label={roleLabel(entry.role)}
          onSelect={() => onChange(entry.role)}
        >
          <span
            className="absolute inset-0 rounded-full"
            style={{ backgroundColor: `#${entry.hex}` }}
          />
        </Swatch>
      ))}
    </div>
  );
}

function Swatch({
  selected,
  label,
  onSelect,
  children,
}: {
  selected: boolean;
  label: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      onClick={onSelect}
      className={cn(
        'relative size-6 shrink-0 overflow-hidden rounded-full outline-none',
        'ring-1 ring-border ring-offset-2 ring-offset-sidebar transition-shadow duration-100',
        'hover:ring-muted-foreground focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'ring-2 ring-foreground hover:ring-foreground',
      )}
    >
      {children}
    </button>
  );
}
