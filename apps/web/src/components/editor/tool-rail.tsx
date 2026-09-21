'use client';

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  AiSparklesIcon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  ArrowUpRight01Icon,
  ChartLineData01Icon,
  CheckListIcon,
  Cursor01Icon,
  DragDropHorizontalIcon,
  DragDropVerticalIcon,
  EllipseIcon,
  Flowchart01Icon,
  HandIcon,
  Image01Icon,
  Layout03Icon,
  MinusSignIcon,
  SquareIcon,
  Table01Icon,
  TextFontIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { dockAxis, type DockAxis, type DockSide } from '@/components/editor/dock';

/**
 * Идентификаторы групп, инструментов и вариантов — они же ключи словаря `toolRail`: подписи
 * живут там, а не в коде. Пропущенная строка словаря ломает проверку типов.
 */
type GroupId = 'canvas' | 'panels';
export type ToolId = 'pointer' | 'text' | 'image' | 'shape' | 'data' | 'layout' | 'audit' | 'ai';
export type VariantId =
  | 'select'
  | 'hand'
  | 'text'
  | 'image'
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'chart'
  | 'table'
  | 'diagram'
  | 'layout'
  | 'audit'
  | 'ai';

/**
 * Один инструмент. `key` показывается в подсказке, `code` слушается, чтобы ярлык работал
 * в любой раскладке. Описания у варианта нет: в окне только название и ярлык.
 */
type Variant = {
  id: VariantId;
  icon: IconSvgElement;
  shortcut?: { key: string; code: string };
};

/**
 * Кнопка панели. Если вариантов несколько, у кнопки появляется шеврон, а она сама показывает
 * иконку последнего выбранного варианта — как в Figma. Список вариантов раскрывается по
 * наведению, клик только убирает задержку.
 *
 * `mode` меняет то, что делает курсор на холсте, и держит индикатор выбора. `action` открывает
 * панель: индикатор на нём не остаётся, иначе по кружку нельзя было бы прочитать текущий
 * инструмент холста.
 */
type Tool = {
  id: ToolId;
  kind: 'mode' | 'action';
  variants: readonly [Variant, ...Variant[]];
};

type Group = {
  id: GroupId;
  tools: readonly Tool[];
};

const GROUPS: readonly Group[] = [
  {
    id: 'canvas',
    tools: [
      {
        id: 'pointer',
        kind: 'mode',
        variants: [
          {
            id: 'select',
            icon: Cursor01Icon,
            shortcut: { key: 'V', code: 'KeyV' },
          },
          {
            id: 'hand',
            icon: HandIcon,
            shortcut: { key: 'H', code: 'KeyH' },
          },
        ],
      },
      {
        id: 'text',
        kind: 'mode',
        variants: [
          {
            id: 'text',
            icon: TextFontIcon,
            shortcut: { key: 'T', code: 'KeyT' },
          },
        ],
      },
      {
        id: 'image',
        kind: 'mode',
        variants: [
          {
            id: 'image',
            icon: Image01Icon,
            shortcut: { key: 'I', code: 'KeyI' },
          },
        ],
      },
      {
        id: 'shape',
        kind: 'mode',
        variants: [
          {
            id: 'rectangle',
            icon: SquareIcon,
            shortcut: { key: 'R', code: 'KeyR' },
          },
          {
            id: 'ellipse',
            icon: EllipseIcon,
            shortcut: { key: 'O', code: 'KeyO' },
          },
          {
            id: 'line',
            icon: MinusSignIcon,
            shortcut: { key: 'L', code: 'KeyL' },
          },
          {
            id: 'arrow',
            icon: ArrowUpRight01Icon,
            shortcut: { key: 'A', code: 'KeyA' },
          },
        ],
      },
      {
        id: 'data',
        kind: 'mode',
        variants: [
          {
            id: 'chart',
            icon: ChartLineData01Icon,
            shortcut: { key: 'G', code: 'KeyG' },
          },
          {
            id: 'table',
            icon: Table01Icon,
            shortcut: { key: 'B', code: 'KeyB' },
          },
          {
            id: 'diagram',
            icon: Flowchart01Icon,
            shortcut: { key: 'S', code: 'KeyS' },
          },
        ],
      },
    ],
  },
  {
    id: 'panels',
    tools: [
      {
        id: 'layout',
        kind: 'action',
        variants: [
          {
            id: 'layout',
            icon: Layout03Icon,
            shortcut: { key: 'M', code: 'KeyM' },
          },
        ],
      },
      {
        id: 'audit',
        kind: 'action',
        variants: [
          {
            id: 'audit',
            icon: CheckListIcon,
            shortcut: { key: 'C', code: 'KeyC' },
          },
        ],
      },
      {
        id: 'ai',
        kind: 'action',
        variants: [
          {
            id: 'ai',
            icon: AiSparklesIcon,
            shortcut: { key: 'J', code: 'KeyJ' },
          },
        ],
      },
    ],
  },
];

const TOOLS = GROUPS.flatMap((group) => group.tools);

const BY_ID = new Map(TOOLS.map((tool) => [tool.id, tool]));

const BY_CODE = new Map(
  TOOLS.flatMap((tool) =>
    tool.variants.flatMap((variant) =>
      variant.shortcut ? [[variant.shortcut.code, { tool, variant }] as const] : [],
    ),
  ),
);

const DEFAULT_VARIANTS: Record<string, string> = Object.fromEntries(
  TOOLS.map((tool) => [tool.id, tool.variants[0].id]),
);

/** Окно ждёт паузу, чтобы не выпадать при проходе курсора вдоль панели. */
const FLYOUT_DELAY_MS = 260;
/**
 * Короткая отсрочка скрытия. Переход между соседними кнопками не гасит окно — ни мышью,
 * ни табом: оно переезжает к следующей кнопке, а не мигает.
 */
const FLYOUT_GRACE_MS = 90;

const PILL_SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.7 } as const;
const FLYOUT_SLIDE = { type: 'spring', stiffness: 520, damping: 40, mass: 0.6 } as const;
const FLYOUT_FADE = { duration: 0.16, ease: 'easeOut' } as const;
/** Схлопывание кнопки, которой сейчас нечего делать на панели. */
const COLLAPSE = { duration: 0.2, ease: 'easeOut' } as const;
const INSTANT = { duration: 0 } as const;

/**
 * Всё, что зависит от того, каким краем панель повёрнута к области: окна раскрываются в
 * сторону свободного места, уголок на кнопке смотрит туда же, и стрелка на клавиатуре
 * открывает список в том же направлении.
 *
 * У горизонтальной панели закрывающей стрелки нет: вверх и вниз внутри списка уже заняты
 * переходом между вариантами, так что оттуда выходят по Escape.
 */
type Layout = {
  /** Точка привязки окна на краю панели. */
  anchor: string;
  /** Ось, по которой окно едет вдоль панели от кнопки к кнопке. */
  along: 'x' | 'y';
  /** Мостик от кнопки к окну: по нему курсор доходит до списка, не теряя его. */
  bridge: string;
  origin: string;
  /** Откуда окно выезжает при появлении. */
  nudge: { x: number; y: number };
  arrow: string;
  open: string;
  close: string | null;
  chevron: { icon: IconSvgElement; corner: string };
};

const LAYOUT: Record<DockSide, Layout> = {
  left: {
    anchor: 'top-0 left-full',
    along: 'y',
    bridge: 'top-1/2 left-0 -translate-y-1/2 pl-2.5',
    origin: 'origin-left',
    nudge: { x: -6, y: 0 },
    arrow: 'top-1/2 left-0 -translate-x-1/2 -translate-y-1/2',
    open: 'ArrowRight',
    close: 'ArrowLeft',
    chevron: { icon: ArrowRight01Icon, corner: 'right-0.5 bottom-0.5' },
  },
  right: {
    anchor: 'top-0 right-full',
    along: 'y',
    bridge: 'top-1/2 right-0 -translate-y-1/2 pr-2.5',
    origin: 'origin-right',
    nudge: { x: 6, y: 0 },
    arrow: 'top-1/2 right-0 translate-x-1/2 -translate-y-1/2',
    open: 'ArrowLeft',
    close: 'ArrowRight',
    chevron: { icon: ArrowLeft01Icon, corner: 'bottom-0.5 left-0.5' },
  },
  top: {
    anchor: 'top-full left-0',
    along: 'x',
    bridge: 'top-0 left-1/2 -translate-x-1/2 pt-2.5',
    origin: 'origin-top',
    nudge: { x: 0, y: -6 },
    arrow: 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2',
    open: 'ArrowDown',
    close: null,
    chevron: { icon: ArrowDown01Icon, corner: 'right-0.5 bottom-0.5' },
  },
  bottom: {
    anchor: 'bottom-full left-0',
    along: 'x',
    bridge: 'bottom-0 left-1/2 -translate-x-1/2 pb-2.5',
    origin: 'origin-bottom',
    nudge: { x: 0, y: 6 },
    arrow: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2',
    open: 'ArrowUp',
    close: null,
    chevron: { icon: ArrowUp01Icon, corner: 'top-0.5 right-0.5' },
  },
};

function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded-sm bg-muted px-1.5 py-0.5 font-sans text-[0.625rem] leading-none text-muted-foreground ring-1 ring-border">
      {children}
    </kbd>
  );
}

function ToolItem({
  tool,
  variant,
  side,
  active,
  expanded,
  onSelect,
  onShow,
  onHide,
  onEnterMenu,
}: {
  tool: Tool;
  variant: Variant;
  side: DockSide;
  active: boolean;
  expanded: boolean;
  onSelect: (tool: Tool, variant: Variant) => void;
  onShow: (tool: Tool, item: HTMLElement, immediate: boolean) => void;
  onHide: (immediate: boolean) => void;
  onEnterMenu: () => void;
}) {
  const t = useTranslations('toolRail');
  const layout = LAYOUT[side];
  const reduceMotion = useReducedMotion() === true;
  const itemRef = useRef<HTMLDivElement>(null);
  const hasVariants = tool.variants.length > 1;

  return (
    <div
      ref={itemRef}
      className="group/item relative px-1 py-0.5"
      onPointerEnter={(event) => {
        if (event.pointerType !== 'mouse' || !itemRef.current) return;
        onShow(tool, itemRef.current, false);
      }}
      onFocus={(event) => {
        if (event.target.matches(':focus-visible') && itemRef.current) {
          onShow(tool, itemRef.current, true);
        }
      }}
    >
      <button
        type="button"
        data-tool={tool.id}
        aria-label={t(`variants.${variant.id}`)}
        aria-pressed={tool.kind === 'mode' ? active : undefined}
        aria-haspopup={hasVariants ? 'menu' : undefined}
        aria-expanded={hasVariants ? expanded : undefined}
        aria-keyshortcuts={variant.shortcut?.key.toLowerCase()}
        onClick={() => {
          onSelect(tool, variant);
          // Клик по кнопке с вариантами только убирает паузу перед окном.
          if (hasVariants && itemRef.current) onShow(tool, itemRef.current, true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onHide(true);
            return;
          }
          if (!hasVariants || event.key !== layout.open) return;
          event.preventDefault();
          if (itemRef.current) onShow(tool, itemRef.current, true);
          onEnterMenu();
        }}
        className={cn(
          'group/tool relative grid size-9 shrink-0 place-items-center rounded-full outline-none',
          'transition-colors focus-visible:ring-2 focus-visible:ring-ring/50',
          active
            ? 'text-primary-foreground'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        {active && (
          <motion.span
            aria-hidden
            layoutId="tool-rail-active"
            transition={reduceMotion ? INSTANT : PILL_SPRING}
            className="absolute inset-0 rounded-full bg-primary shadow-sm"
          />
        )}
        <HugeiconsIcon
          icon={variant.icon}
          size={18}
          strokeWidth={1.5}
          color="currentColor"
          className="relative transition-transform duration-100 group-active/tool:scale-90 motion-reduce:transition-none"
        />
        {hasVariants && (
          <span
            aria-hidden
            className={cn(
              'absolute grid size-3 place-items-center',
              layout.chevron.corner,
              'opacity-50 transition-opacity group-hover/item:opacity-100',
              expanded && 'opacity-100',
            )}
          >
            <HugeiconsIcon
              icon={layout.chevron.icon}
              size={9}
              strokeWidth={3.5}
              color="currentColor"
            />
          </span>
        )}
      </button>
    </div>
  );
}

type FlyoutState = { tool: Tool; variant: Variant; side: DockSide; pos: number };

/**
 * Одно окно на всю панель: у инструмента с единственным вариантом это подсказка, у группы —
 * сразу выбор инструмента. При переходе между кнопками окно переезжает, а не мигает.
 *
 * Окно живёт на том краю панели, который смотрит в свободное место, и едет вдоль панели:
 * у вертикальной — по высоте, у горизонтальной — по ширине.
 */
function ToolFlyout({
  state,
  menuRef,
  onSelect,
  onKeep,
  onHide,
  onMenuKeyDown,
}: {
  state: FlyoutState | null;
  menuRef: RefObject<HTMLDivElement | null>;
  onSelect: (tool: Tool, variant: Variant) => void;
  onKeep: () => void;
  onHide: (immediate: boolean) => void;
  onMenuKeyDown: (event: KeyboardEvent<HTMLButtonElement>, tool: Tool) => void;
}) {
  const t = useTranslations('toolRail');
  const reduceMotion = useReducedMotion() === true;
  const isMenu = state !== null && state.tool.variants.length > 1;
  const layout = LAYOUT[state?.side ?? 'left'];
  const slide = state && (layout.along === 'y' ? { y: state.pos } : { x: state.pos });

  return (
    <AnimatePresence>
      {state && slide && (
        <motion.div
          key={layout.along}
          aria-hidden={!isMenu}
          className={cn('pointer-events-none absolute size-0', layout.anchor)}
          initial={slide}
          animate={slide}
          transition={reduceMotion ? INSTANT : FLYOUT_SLIDE}
        >
          <div
            // Мостик от кнопки к окну: курсор идёт по нему, не теряя список.
            className={cn('absolute', layout.bridge, isMenu && 'pointer-events-auto')}
            onPointerEnter={onKeep}
            onPointerLeave={() => onHide(false)}
          >
            <motion.div
              className={layout.origin}
              initial={{ opacity: 0, scale: 0.96, ...layout.nudge }}
              animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, ...layout.nudge }}
              transition={reduceMotion ? INSTANT : FLYOUT_FADE}
            >
              <motion.div
                layout={reduceMotion ? false : 'size'}
                transition={reduceMotion ? INSTANT : FLYOUT_SLIDE}
                className="relative isolate"
              >
                <span
                  className={cn(
                    'absolute -z-10 size-3 rotate-45 rounded-[3px] bg-popover ring-1 ring-border',
                    layout.arrow,
                  )}
                />

                {isMenu ? (
                  <div
                    ref={menuRef}
                    role="menu"
                    aria-label={t(`tools.${state.tool.id}`)}
                    className="min-w-40 rounded-xl bg-popover p-1 shadow-xl shadow-black/30 ring-1 ring-border"
                  >
                    {state.tool.variants.map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        role="menuitemradio"
                        data-variant={candidate.id}
                        aria-checked={candidate.id === state.variant.id}
                        onClick={() => onSelect(state.tool, candidate)}
                        onKeyDown={(event) => onMenuKeyDown(event, state.tool)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 pl-1.5 outline-none',
                          'text-muted-foreground transition-colors',
                          'hover:bg-muted hover:text-foreground',
                          'focus-visible:bg-muted focus-visible:text-foreground',
                          'aria-checked:text-foreground',
                        )}
                      >
                        <span className="grid size-3.5 shrink-0 place-items-center">
                          {candidate.id === state.variant.id && (
                            <HugeiconsIcon
                              icon={Tick02Icon}
                              size={12}
                              strokeWidth={2.5}
                              color="currentColor"
                            />
                          )}
                        </span>
                        <HugeiconsIcon
                          icon={candidate.icon}
                          size={14}
                          strokeWidth={1.5}
                          color="currentColor"
                        />
                        <span className="text-xs whitespace-nowrap">
                          {t(`variants.${candidate.id}`)}
                        </span>
                        {candidate.shortcut && (
                          <span className="ml-auto pl-4">
                            <Key>{candidate.shortcut.key}</Key>
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="w-max rounded-xl bg-popover px-3 py-2 shadow-xl shadow-black/30 ring-1 ring-border">
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <span className="text-xs font-medium text-popover-foreground">
                        {t(`variants.${state.variant.id}`)}
                      </span>
                      {state.variant.shortcut && <Key>{state.variant.shortcut.key}</Key>}
                    </div>
                  </div>
                )}
              </motion.div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function RailSeparator({ axis }: { axis: DockAxis }) {
  return (
    <Separator
      orientation={axis === 'vertical' ? 'horizontal' : 'vertical'}
      className={axis === 'vertical' ? 'my-1 w-6' : 'mx-1 h-6 self-center'}
    />
  );
}

/**
 * Ручка, за которую панель перетаскивают. Поведение задаёт владелец панели: она знает только
 * о том, как ручка выглядит и куда смотрит.
 */
export function RailGrip({
  axis,
  dragging,
  className,
  ...props
}: ComponentProps<'button'> & { axis: DockAxis; dragging: boolean }) {
  const t = useTranslations('toolRail');

  return (
    <button
      type="button"
      aria-label={t('grip')}
      className={cn(
        'grid shrink-0 touch-none place-items-center rounded-full outline-none',
        'text-muted-foreground/50 transition-colors hover:text-foreground',
        'focus-visible:ring-2 focus-visible:ring-ring/50',
        axis === 'vertical' ? 'h-6 w-9' : 'h-9 w-6',
        dragging ? 'cursor-grabbing text-foreground' : 'cursor-grab',
        className,
      )}
      {...props}
    >
      <HugeiconsIcon
        icon={axis === 'vertical' ? DragDropHorizontalIcon : DragDropVerticalIcon}
        size={16}
        strokeWidth={2}
        color="currentColor"
      />
    </button>
  );
}

export function ToolRail({
  className,
  side = 'left',
  frozen = false,
  grip,
  hiddenTools,
  onSelect,
}: {
  className?: string;
  /** Край, к которому панель обращена: от него зависят ориентация и сторона окон. */
  side?: DockSide;
  /** Пока панель тащат, окна не открываются: под курсором едет сама панель. */
  frozen?: boolean;
  /** Ручка перетаскивания. Панель только ставит её в начало ряда. */
  grip?: ReactNode;
  /** Инструменты, которым сейчас нечего делать: кнопка плавно уходит с панели. */
  hiddenTools?: readonly ToolId[];
  onSelect?: (id: VariantId) => void;
}) {
  const t = useTranslations('toolRail');
  const reduceMotion = useReducedMotion() === true;
  const axis = dockAxis(side);
  const layout = LAYOUT[side];
  const [activeId, setActiveId] = useState(DEFAULT_VARIANTS.pointer);
  const [chosen, setChosen] = useState(DEFAULT_VARIANTS);
  const [open, setOpen] = useState<{ toolId: ToolId; pos: number } | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const shownRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const onSelectRef = useRef(onSelect);
  const axisRef = useRef(axis);
  const frozenRef = useRef(frozen);

  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  axisRef.current = axis;
  frozenRef.current = frozen;

  const hiddenKey = (hiddenTools ?? []).join('|');
  const hidden = useMemo(() => new Set(hiddenKey === '' ? [] : hiddenKey.split('|')), [hiddenKey]);

  const currentVariant = useCallback(
    (tool: Tool) =>
      tool.variants.find((variant) => variant.id === chosen[tool.id]) ?? tool.variants[0],
    [chosen],
  );

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const show = useCallback(
    (tool: Tool, item: HTMLElement, immediate: boolean) => {
      if (frozenRef.current) return;
      clearTimer();
      // offsetParent — сама панель, так что это центр кнопки в её координатах.
      const next = {
        toolId: tool.id,
        pos:
          axisRef.current === 'vertical'
            ? item.offsetTop + item.offsetHeight / 2
            : item.offsetLeft + item.offsetWidth / 2,
      };

      if (immediate || shownRef.current) {
        shownRef.current = true;
        setOpen(next);
        return;
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        shownRef.current = true;
        setOpen(next);
      }, FLYOUT_DELAY_MS);
    },
    [clearTimer],
  );

  const hide = useCallback(
    (immediate: boolean) => {
      clearTimer();
      if (immediate) {
        shownRef.current = false;
        setOpen(null);
        return;
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        shownRef.current = false;
        setOpen(null);
      }, FLYOUT_GRACE_MS);
    },
    [clearTimer],
  );

  // Кнопка ушла с панели — вместе с ней уходит и её окно.
  useEffect(() => {
    if (open && hidden.has(open.toolId)) hide(true);
  }, [open, hidden, hide]);

  // Панель развернулась или поехала за курсором: прежнее окно уже не у своей кнопки.
  useEffect(() => {
    hide(true);
  }, [side, frozen, hide]);

  const select = useCallback((tool: Tool, variant: Variant) => {
    setChosen((previous) => ({ ...previous, [tool.id]: variant.id }));
    if (tool.kind === 'mode') setActiveId(variant.id);
    onSelectRef.current?.(variant.id);
  }, []);

  const menuItems = useCallback(
    () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[data-variant]') ?? []),
    [],
  );

  /** С кнопки в список: фокус встаёт на текущий вариант, а не на первый по порядку. */
  const enterMenu = useCallback(() => {
    requestAnimationFrame(() => {
      const items = menuItems();
      const checked = items.findIndex((item) => item.getAttribute('aria-checked') === 'true');
      items[checked < 0 ? 0 : checked]?.focus();
    });
  }, [menuItems]);

  /**
   * Возврат на кнопку. Фокус переносим до закрытия: иначе `onFocus` кнопки успел бы
   * открыть окно заново.
   */
  const leaveMenu = useCallback(
    (tool: Tool) => {
      navRef.current?.querySelector<HTMLButtonElement>(`[data-tool="${tool.id}"]`)?.focus();
      hide(true);
    },
    [hide],
  );

  const selectFromMenu = useCallback(
    (tool: Tool, variant: Variant) => {
      select(tool, variant);
      leaveMenu(tool);
    },
    [select, leaveMenu],
  );

  const onMenuKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, tool: Tool) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const items = menuItems();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const index = items.indexOf(event.currentTarget);
        items[(index + step + items.length) % items.length]?.focus();
        return;
      }
      if (event.key === 'Escape' || event.key === layout.close) {
        event.preventDefault();
        leaveMenu(tool);
      }
    },
    [menuItems, leaveMenu, layout.close],
  );

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.repeat || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;

      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;

      const hit = BY_CODE.get(event.code);
      if (!hit || hidden.has(hit.tool.id)) return;

      event.preventDefault();
      select(hit.tool, hit.variant);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [select, hidden]);

  const openTool = open ? BY_ID.get(open.toolId) : undefined;
  const flyout: FlyoutState | null =
    open && openTool
      ? { tool: openTool, variant: currentVariant(openTool), side, pos: open.pos }
      : null;

  /** Схлопывание кнопки идёт вдоль ряда, поэтому у развёрнутой панели это ширина. */
  const collapsed =
    axis === 'vertical'
      ? { height: 0, opacity: 0, scale: 0.75 }
      : { width: 0, opacity: 0, scale: 0.75 };

  return (
    <nav
      ref={navRef}
      aria-label={t('label')}
      onPointerLeave={() => hide(false)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hide(true);
      }}
      className={cn(
        'relative flex items-center rounded-full p-1',
        axis === 'vertical' ? 'w-13 flex-col' : 'h-13 flex-row',
        'bg-card/80 shadow-lg shadow-black/20 ring-1 ring-border backdrop-blur-md',
        className,
      )}
    >
      {grip && (
        <>
          {grip}
          <RailSeparator axis={axis} />
        </>
      )}

      {GROUPS.map((group, index) => (
        <Fragment key={group.id}>
          {index > 0 && <RailSeparator axis={axis} />}
          <div
            role="group"
            aria-label={t(`groups.${group.id}`)}
            className={cn('flex items-center', axis === 'vertical' ? 'flex-col' : 'flex-row')}
          >
            <AnimatePresence initial={false}>
              {group.tools
                .filter((tool) => !hidden.has(tool.id))
                .map((tool) => {
                  const variant = currentVariant(tool);
                  return (
                    <motion.div
                      key={tool.id}
                      className="overflow-hidden"
                      initial={collapsed}
                      animate={{ width: 'auto', height: 'auto', opacity: 1, scale: 1 }}
                      exit={collapsed}
                      transition={reduceMotion ? INSTANT : COLLAPSE}
                    >
                      <ToolItem
                        tool={tool}
                        variant={variant}
                        side={side}
                        active={tool.kind === 'mode' && variant.id === activeId}
                        expanded={open?.toolId === tool.id}
                        onSelect={select}
                        onShow={show}
                        onHide={hide}
                        onEnterMenu={enterMenu}
                      />
                    </motion.div>
                  );
                })}
            </AnimatePresence>
          </div>
        </Fragment>
      ))}

      <ToolFlyout
        state={flyout}
        menuRef={menuRef}
        onSelect={selectFromMenu}
        onKeep={clearTimer}
        onHide={hide}
        onMenuKeyDown={onMenuKeyDown}
      />
    </nav>
  );
}
