'use client';

import type { ReactNode } from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

// Поля ввода живут в `fields/`; панель берёт всё отсюда, из одного места.
export {
  NumberField,
  type NumberFieldProps,
} from '@/components/editor/inspector/fields/number-field';
export {
  NumberCombobox,
  type NumberPreset,
} from '@/components/editor/inspector/fields/number-combobox';
export { ColorField } from '@/components/editor/inspector/fields/color-field';
export { FontPicker } from '@/components/editor/inspector/fields/font-picker';
export {
  FontStyleField,
  SelectField,
  type FontStyle,
} from '@/components/editor/inspector/fields/select-field';

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
    <section className="flex flex-col gap-2 border-b border-border px-3 pt-2 pb-3 last:border-b-0">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold text-foreground">{title}</h3>
        {actions ? <div className="flex items-center gap-0.5">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Строка из двух полей одинаковой ширины, как в Figma. */
export function FieldRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-2 gap-2', className)}>{children}</div>;
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
