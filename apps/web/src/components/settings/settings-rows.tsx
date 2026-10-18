'use client';

import { useId, type ReactNode } from 'react';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

/** Заголовок раздела настроек с пояснением — одинаковый во всех разделах. */
export function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="grid gap-1 md:pr-8">
      <h2 className="text-base font-semibold">{title}</h2>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col">
      <h3 id={id} className="pb-1 text-xs font-medium text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Строка настройки: подпись и пояснение слева, управление справа, как строка языка в «Общих». */
export function Row({
  label,
  hint,
  labelId,
  children,
}: {
  label: ReactNode;
  hint?: string;
  labelId: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border py-2.5">
      <div className="grid min-w-0 flex-1 basis-48 gap-0.5">
        <span id={labelId} className="text-sm">
          {label}
        </span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

export function SwitchRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const labelId = useId();
  return (
    <Row label={label} hint={hint} labelId={labelId}>
      <Switch
        aria-labelledby={labelId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </Row>
  );
}

/** Короткий выбор — сегменты; длинный список значений — обычный select. */
export function ChoiceRow<T extends string | number>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const labelId = useId();
  return (
    <Row label={label} hint={hint} labelId={labelId}>
      {options.length > 5 ? (
        <select
          aria-labelledby={labelId}
          value={String(value)}
          onChange={(event) => {
            const option = options.find(
              (candidate) => String(candidate.id) === event.currentTarget.value,
            );
            if (option) onChange(option.id);
          }}
          className="h-11 max-w-full min-w-24 rounded-md border border-border bg-background px-3 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:h-8 md:text-sm"
        >
          {options.map((option) => (
            <option key={String(option.id)} value={String(option.id)}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <ToggleGroupPrimitive.Root
          type="single"
          aria-labelledby={labelId}
          value={String(value)}
          onValueChange={(next) => {
            // Повторный клик по выбранному сегменту снимает выбор — у нас значение есть всегда.
            const option = options.find((candidate) => String(candidate.id) === next);
            if (option) onChange(option.id);
          }}
          className="flex max-w-full flex-wrap rounded-lg bg-muted p-0.5"
        >
          {options.map((option) => (
            <ToggleGroupPrimitive.Item
              key={String(option.id)}
              value={String(option.id)}
              className={cn(
                'min-h-11 min-w-11 rounded-md px-2.5 text-sm text-muted-foreground outline-none md:min-h-7 md:min-w-8 md:text-xs',
                'transition-colors duration-100 motion-reduce:transition-none',
                'hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
                'data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm',
              )}
            >
              {option.label}
            </ToggleGroupPrimitive.Item>
          ))}
        </ToggleGroupPrimitive.Root>
      )}
    </Row>
  );
}
