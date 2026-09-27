'use client';

import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { useTranslations } from 'next-intl';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PROJECT_ICONS, ProjectIcon, projectTint } from '@/components/library/project-icon';
import {
  PROJECT_COLOR_IDS,
  PROJECT_ICON_IDS,
  projectColorVar,
  type ProjectAppearance,
} from '@/lib/project-appearance';
import { cn } from '@/lib/utils';

/** Сколько иконок в ряду сетки: двадцать иконок ложатся в четыре ровных ряда. */
const ICON_COLUMNS = 5;

/**
 * Выбор иконки и цвета проекта, как в ChatGPT: превью, сетка иконок и ряд цветов. Каждый
 * щелчок — сразу новое значение: сохранять его решает вызывающий, панель ничего не ждёт.
 *
 * Обе группы — радиогруппы с подписями. Стрелки переводят фокус по сетке, Enter или пробел
 * выбирают, Esc закрывает панель.
 *
 * Панель открывает либо своя кнопка (`children`), либо меню объекта: тогда кнопки нет, панель
 * привязана к самому объекту (`anchorRef`), а фокус после закрытия возвращает `onCloseAutoFocus`.
 */
export function ProjectAppearancePicker({
  value,
  onChange,
  open,
  onOpenChange,
  anchorRef,
  onCloseAutoFocus,
  children,
}: {
  value: ProjectAppearance;
  onChange: (next: ProjectAppearance) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Элемент, у которого встаёт панель, когда своей кнопки нет. */
  anchorRef?: RefObject<HTMLElement | null>;
  onCloseAutoFocus?: (event: Event) => void;
  /** Кнопка, которая открывает панель. */
  children?: ReactNode;
}) {
  const t = useTranslations('projectAppearance');
  const titleId = useId();
  const iconsId = useId();
  const colorsId = useId();
  const hintId = useId();
  const iconGroup = useRef<HTMLDivElement>(null);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {anchorRef ? (
        <PopoverAnchor virtualRef={anchorRef as RefObject<HTMLElement>} />
      ) : (
        <PopoverTrigger asChild>{children}</PopoverTrigger>
      )}
      <PopoverContent
        aria-labelledby={titleId}
        onCloseAutoFocus={onCloseAutoFocus}
        aria-describedby={hintId}
        className="flex w-64 flex-col gap-3"
        onOpenAutoFocus={(event) => {
          // Фокус — на выбранную иконку, а не на первую: с неё удобнее идти стрелками.
          event.preventDefault();
          iconGroup.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
        }}
      >
        <div className="flex items-center gap-3">
          <ProjectIcon appearance={value} size="lg" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p id={titleId} className="text-sm font-medium">
              {t('label')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t(`iconNames.${value.icon}`)} · {t(`colorNames.${value.color}`)}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <p id={iconsId} className="text-xs text-muted-foreground">
            {t('icons')}
          </p>
          <RadioGrid
            ref={iconGroup}
            labelledBy={iconsId}
            items={PROJECT_ICON_IDS}
            selected={value.icon}
            columns={ICON_COLUMNS}
            className="grid-cols-5 gap-1"
            onSelect={(icon) => onChange({ ...value, icon })}
            label={(icon) => t(`iconNames.${icon}`)}
            render={(icon, checked) => {
              const Glyph = PROJECT_ICONS[icon];
              return (
                <span
                  className={cn(
                    'grid aspect-square w-full place-items-center rounded-md',
                    'transition-colors duration-100 motion-reduce:transition-none',
                    // Выбранная иконка — в цвете проекта на нейтральной подложке выбора.
                    checked ? 'bg-muted' : 'text-muted-foreground group-hover/radio:bg-muted',
                  )}
                  style={checked ? projectTint(value.color) : undefined}
                >
                  <Glyph size={18} />
                </span>
              );
            }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <p id={colorsId} className="text-xs text-muted-foreground">
            {t('colors')}
          </p>
          <RadioGrid
            labelledBy={colorsId}
            items={PROJECT_COLOR_IDS}
            selected={value.color}
            columns={PROJECT_COLOR_IDS.length}
            className="grid-cols-9 gap-1"
            itemClassName="rounded-full"
            onSelect={(color) => onChange({ ...value, color })}
            label={(color) => t(`colorNames.${color}`)}
            render={(color, checked) => (
              <span
                className={cn(
                  'block aspect-square w-full rounded-full ring-offset-2 ring-offset-popover',
                  checked && 'ring-2 ring-foreground',
                )}
                style={{ backgroundColor: projectColorVar(color) }}
              />
            )}
          />
        </div>

        <p id={hintId} className="text-[0.6875rem] text-muted-foreground">
          {t('hint')}
        </p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Радиогруппа кнопками с «блуждающим» фокусом: в порядке Tab стоит одна кнопка группы,
 * по остальным ходят стрелками. Стрелки вверх и вниз прыгают на ряд; когда ряд один,
 * они ходят как влево и вправо.
 */
function RadioGrid<T extends string>({
  ref,
  labelledBy,
  items,
  selected,
  columns,
  className,
  itemClassName,
  onSelect,
  label,
  render,
}: {
  ref?: Ref<HTMLDivElement>;
  labelledBy: string;
  items: readonly T[];
  selected: T;
  columns: number;
  className?: string;
  /** Форма кнопки: по ней рисуется кольцо фокуса. */
  itemClassName?: string;
  onSelect: (item: T) => void;
  label: (item: T) => string;
  render: (item: T, checked: boolean) => ReactNode;
}) {
  // Какая кнопка группы стоит в порядке Tab: выбранная, пока фокус не ушёл стрелками дальше.
  const [focused, setFocused] = useState<T | null>(null);
  const tabStop = focused !== null && items.includes(focused) ? focused : selected;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
    const current = buttons.indexOf(document.activeElement as HTMLElement);
    if (current === -1) return;
    const row = columns >= items.length ? 1 : columns;
    const last = items.length - 1;
    const next = {
      ArrowRight: current === last ? 0 : current + 1,
      ArrowLeft: current === 0 ? last : current - 1,
      ArrowDown: Math.min(current + row, last),
      ArrowUp: Math.max(current - row, 0),
      Home: 0,
      End: last,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
      className={cn('grid', className)}
    >
      {items.map((item) => {
        const checked = item === selected;
        return (
          <button
            key={item}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={label(item)}
            title={label(item)}
            tabIndex={item === tabStop ? 0 : -1}
            onFocus={() => setFocused(item)}
            onClick={() => onSelect(item)}
            className={cn(
              'group/radio rounded-md outline-none',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-popover',
              itemClassName,
            )}
          >
            {render(item, checked)}
          </button>
        );
      })}
    </div>
  );
}
