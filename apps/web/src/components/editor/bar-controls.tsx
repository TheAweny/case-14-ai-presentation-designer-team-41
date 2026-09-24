'use client';

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ComponentProps,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { ArrowDown01Icon } from '@hugeicons/core-free-icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useMenuFocus } from '@/components/editor/chrome-focus';
import { shortcutLabel } from '@/components/editor/editor-keymap';
import { leavesField, rovingIndex } from '@/components/editor/selection-bar-model';
import { cn } from '@/lib/utils';

/*
 * Кирпичики полос над холстом: полосы свойств выделения и полосы формата в наборе текста.
 * Подсказки и меню открываются в сторону от выделения, чтобы не закрывать его; сторону знает
 * сама полоса и раздаёт её через контекст.
 */

export type BarSide = 'top' | 'bottom';

export const BarSideContext = createContext<BarSide>('top');

const subscribeNothing = () => () => undefined;

/** ⌘ на Mac, Ctrl на остальных. На сервере — Ctrl, после гидратации — как у человека. */
function useMac(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => false,
  );
}

/** Сочетание в подсказке: одна клавиша — одна плашка. */
export function ShortcutKeys({ keys }: { keys: readonly string[] }) {
  const mac = useMac();
  if (keys.length === 0) return null;
  return (
    <span className="flex gap-0.5">
      {keys.map((key) => (
        <Kbd key={key}>{shortcutLabel([key], mac)}</Kbd>
      ))}
    </span>
  );
}

/** Подсказка с названием и сочетанием, в сторону от выделения. */
export function BarTooltip({
  label,
  keys,
  children,
}: {
  label: string;
  keys?: readonly string[];
  children: ReactNode;
}) {
  const side = useContext(BarSideContext);
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>
        {label}
        {keys ? <ShortcutKeys keys={keys} /> : null}
      </TooltipContent>
    </Tooltip>
  );
}

export const BAR_BUTTON_CLASS = cn(
  'flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-lg px-1.5 text-xs text-muted-foreground outline-none',
  'transition-colors duration-100 motion-reduce:transition-none',
  'hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
  'disabled:pointer-events-none disabled:opacity-40',
  'data-[state=open]:bg-muted data-[state=open]:text-foreground',
);

/**
 * Кнопка полосы. Все остальные свойства и `ref` уходят на саму кнопку: её можно ставить под
 * `asChild` меню Radix, и тот повесит на неё свои обработчики. Без этого меню не открывалось бы.
 */
export function BarButton({
  icon,
  label,
  keys,
  pressed,
  tone,
  className,
  children,
  ...rest
}: Omit<ComponentProps<'button'>, 'children'> & {
  icon?: IconSvgElement;
  label: string;
  keys?: readonly string[];
  /** Переключатель: `aria-pressed` и подсветка включённого. */
  pressed?: boolean;
  tone?: 'danger';
  children?: ReactNode;
}) {
  return (
    <BarTooltip label={label} keys={keys}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        {...rest}
        className={cn(
          BAR_BUTTON_CLASS,
          pressed && 'bg-foreground/15 text-foreground hover:bg-foreground/20',
          tone === 'danger' && 'hover:text-destructive',
          className,
        )}
      >
        {icon ? (
          <HugeiconsIcon icon={icon} size={16} strokeWidth={1.5} color="currentColor" />
        ) : null}
        {children}
      </button>
    </BarTooltip>
  );
}

/**
 * Кнопка с выпадающим меню: иконка и шеврон. Меню помечено как интерфейс поверх холста и
 * после закрытия мышью не возвращает фокус на кнопку.
 */
export function BarMenu({
  icon,
  label,
  keys,
  children,
  content,
  disabled,
  contentClassName,
}: {
  icon?: IconSvgElement;
  label: string;
  keys?: readonly string[];
  /** Что нарисовать в кнопке рядом с иконкой. */
  children?: ReactNode;
  /** Пункты меню. */
  content: ReactNode;
  disabled?: boolean;
  contentClassName?: string;
}) {
  const side = useContext(BarSideContext);
  const focus = useMenuFocus();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled} {...focus.trigger}>
        <BarButton icon={icon} label={label} keys={keys} aria-haspopup="menu">
          {children}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={10}
            strokeWidth={2}
            color="currentColor"
            className="-ml-0.5 opacity-70"
          />
        </BarButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-editor-chrome=""
        side={side}
        sideOffset={6}
        collisionPadding={8}
        onCloseAutoFocus={focus.onCloseAutoFocus}
        className={cn('z-[4000] w-auto min-w-44', contentClassName)}
      >
        {content}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Составной контрол (поле, пикер) под общей подсказкой полосы. */
export function BarItem({
  label,
  keys,
  className,
  children,
}: {
  label: string;
  keys?: readonly string[];
  className?: string;
  children: ReactNode;
}) {
  return (
    <BarTooltip label={label} keys={keys}>
      <span className={cn('flex shrink-0 items-center', className)}>{children}</span>
    </BarTooltip>
  );
}

export function BarSeparator() {
  return (
    <Separator
      orientation="vertical"
      className="mx-0.5 data-vertical:h-5 data-vertical:self-center"
    />
  );
}

/** Всё, куда в полосе попадает фокус: кнопки и поля, включая кнопки внутри полей. */
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled)';

/**
 * Roving tabindex для полосы: в неё попадают одним Tab на последний тронутый контрол, дальше
 * ходят стрелками, Home и End. Из поля ввода стрелка уходит, только когда каретка у края.
 * Контролы бывают вложенными (кнопка внутри поля), поэтому список — по DOM, а tabindex
 * ставится прямо на узлы, после каждого рендера.
 */
export function useRovingToolbar() {
  const root = useRef<HTMLElement | null>(null);
  const active = useRef<HTMLElement | null>(null);

  const sync = useCallback(() => {
    const node = root.current;
    if (!node) return;
    const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const current = items.find((item) => item === active.current) ?? items[0];
    for (const item of items) item.tabIndex = item === current ? 0 : -1;
  }, []);

  useLayoutEffect(sync);

  const ref = useCallback(
    (node: HTMLElement | null) => {
      root.current = node;
      sync();
    },
    [sync],
  );

  const onFocus = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      const target = event.target;
      if (!event.currentTarget.contains(target) || !target.matches(FOCUSABLE)) return;
      active.current = target;
      sync();
    },
    [sync],
  );

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !event.currentTarget.contains(target)) return;
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (target instanceof HTMLInputElement) {
      const caret = {
        start: target.selectionStart,
        end: target.selectionEnd,
        length: target.value.length,
      };
      if (!leavesField(event.key, caret)) return;
    }
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const next = rovingIndex(items.indexOf(target), items.length, event.key);
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  }, []);

  return { ref, onFocus, onKeyDown };
}
