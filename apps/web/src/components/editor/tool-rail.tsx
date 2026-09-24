'use client';

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
} from 'react';
import { useTranslations } from 'next-intl';
import { Toolbar as ToolbarPrimitive } from 'radix-ui';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  AiSparklesIcon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowTurnBackwardIcon,
  ArrowTurnForwardIcon,
  ArrowUp01Icon,
  ArrowUpRight01Icon,
  ChartLineData01Icon,
  Cursor01Icon,
  DragDropHorizontalIcon,
  DragDropVerticalIcon,
  EllipseIcon,
  Flowchart01Icon,
  HandIcon,
  Image01Icon,
  MinusSignIcon,
  SquareIcon,
  Table01Icon,
  TextFontIcon,
} from '@hugeicons/core-free-icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { keepCanvasFocus, useMenuFocus } from '@/components/editor/chrome-focus';
import { dockAxis, type DockAxis, type DockSide } from '@/components/editor/dock';
import { isTypingTarget } from '@/components/editor/slide-navigation';
import type { ChangeKind } from '@/components/editor/use-deck-history';

/**
 * Идентификаторы инструментов и вариантов — они же ключи словаря `toolRail`: подписи
 * живут там, а не в коде. Пропущенная строка словаря ломает проверку типов.
 *
 * Инструмент меняет то, что делает курсор на холсте; выбран всегда ровно один. Действие
 * (`RailActionId`) открывает панель и инструмент холста не трогает.
 */
export type ToolId = 'pointer' | 'text' | 'image' | 'shape' | 'data';
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
  | 'diagram';
export type RailActionId = 'ai';

/** Кнопки истории живут на той же панели, но это не инструменты: вариантов у них нет. */
type HistoryId = 'undo' | 'redo';

/**
 * Что вернёт каждая кнопка истории. `null` — возвращать нечего, и кнопка выключена, но
 * стоит на своём месте: панель не меняет длину и кнопки не уезжают из-под курсора.
 */
export type RailHistory = {
  undo: ChangeKind | null;
  redo: ChangeKind | null;
  onUndo: () => void;
  onRedo: () => void;
};

/** Клавиши слушает сам редактор. Панель их только подписывает — по-своему на Mac. */
const HISTORY_KEYS: Record<
  HistoryId,
  { pc: readonly string[]; mac: readonly string[]; aria: string }
> = {
  undo: { pc: ['Ctrl', 'Z'], mac: ['⌘', 'Z'], aria: 'Control+Z Meta+Z' },
  redo: { pc: ['Ctrl', 'Shift', 'Z'], mac: ['⌘', '⇧', 'Z'], aria: 'Control+Shift+Z Meta+Shift+Z' },
};

const HISTORY_ICONS: Record<HistoryId, IconSvgElement> = {
  undo: ArrowTurnBackwardIcon,
  redo: ArrowTurnForwardIcon,
};

function historyKeys(id: HistoryId): readonly string[] {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
  return mac ? HISTORY_KEYS[id].mac : HISTORY_KEYS[id].pc;
}

/**
 * Ярлык: `key` показывается в подсказке, `code` слушается, чтобы ярлык работал в любой
 * раскладке.
 */
type Shortcut = { key: string; code: string };

type Variant = { id: VariantId; icon: IconSvgElement; shortcut: Shortcut };

/**
 * Кнопка панели. Если вариантов несколько, рядом с ней шеврон: он открывает список, а сама
 * кнопка показывает последний выбранный вариант и включает его — как в Figma.
 */
type Tool = { id: ToolId; variants: readonly [Variant, ...Variant[]] };

type Action = { id: RailActionId; icon: IconSvgElement; shortcut: Shortcut };

const TOOLS: readonly Tool[] = [
  {
    id: 'pointer',
    variants: [
      { id: 'select', icon: Cursor01Icon, shortcut: { key: 'V', code: 'KeyV' } },
      { id: 'hand', icon: HandIcon, shortcut: { key: 'H', code: 'KeyH' } },
    ],
  },
  {
    id: 'text',
    variants: [{ id: 'text', icon: TextFontIcon, shortcut: { key: 'T', code: 'KeyT' } }],
  },
  {
    id: 'image',
    variants: [{ id: 'image', icon: Image01Icon, shortcut: { key: 'I', code: 'KeyI' } }],
  },
  {
    id: 'shape',
    variants: [
      { id: 'rectangle', icon: SquareIcon, shortcut: { key: 'R', code: 'KeyR' } },
      { id: 'ellipse', icon: EllipseIcon, shortcut: { key: 'O', code: 'KeyO' } },
      { id: 'line', icon: MinusSignIcon, shortcut: { key: 'L', code: 'KeyL' } },
      { id: 'arrow', icon: ArrowUpRight01Icon, shortcut: { key: 'A', code: 'KeyA' } },
    ],
  },
  {
    id: 'data',
    variants: [
      { id: 'chart', icon: ChartLineData01Icon, shortcut: { key: 'G', code: 'KeyG' } },
      { id: 'table', icon: Table01Icon, shortcut: { key: 'B', code: 'KeyB' } },
      { id: 'diagram', icon: Flowchart01Icon, shortcut: { key: 'S', code: 'KeyS' } },
    ],
  },
];

const ACTIONS: readonly Action[] = [
  { id: 'ai', icon: AiSparklesIcon, shortcut: { key: 'J', code: 'KeyJ' } },
];

const TOOL_BY_ID = new Map(TOOLS.map((tool) => [tool.id, tool]));

const TOOL_BY_VARIANT = new Map(
  TOOLS.flatMap((tool) => tool.variants.map((variant) => [variant.id, tool] as const)),
);

type ShortcutHit =
  { kind: 'variant'; tool: Tool; variant: Variant } | { kind: 'action'; action: Action };

const BY_CODE = new Map<string, ShortcutHit>([
  ...TOOLS.flatMap((tool) =>
    tool.variants.map(
      (variant) => [variant.shortcut.code, { kind: 'variant', tool, variant }] as const,
    ),
  ),
  ...ACTIONS.map((action) => [action.shortcut.code, { kind: 'action', action }] as const),
]);

const DEFAULT_VARIANTS = Object.fromEntries(
  TOOLS.map((tool) => [tool.id, tool.variants[0].id]),
) as Record<ToolId, VariantId>;

/** Окна раскрываются в сторону свободного места: от края, к которому панель прижата. */
const OPEN_TOWARD: Record<DockSide, DockSide> = {
  left: 'right',
  right: 'left',
  top: 'bottom',
  bottom: 'top',
};

const CHEVRON: Record<DockSide, IconSvgElement> = {
  left: ArrowRight01Icon,
  right: ArrowLeft01Icon,
  top: ArrowDown01Icon,
  bottom: ArrowUp01Icon,
};

const BUTTON = cn(
  'grid size-9 shrink-0 place-items-center rounded-full outline-none',
  'text-muted-foreground transition-colors duration-100 motion-reduce:transition-none',
  'hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
  'disabled:pointer-events-none disabled:opacity-35',
);

/** Подсказка у кнопки: название и клавиши в одну строку. Только подсказка, без меню. */
function RailTooltip({
  label,
  keys,
  side,
  children,
}: {
  label: string;
  keys?: readonly string[];
  side: DockSide;
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className="z-[4000]">
        {label}
        {keys && keys.length > 0 && (
          <span className="flex gap-0.5">
            {keys.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Размеры задаём под тем же вариантом, что и у базовых классов разделителя: без него
 * `data-vertical:self-stretch` и `data-horizontal:w-full` стоят в CSS позже и перебивают наши.
 */
function RailSeparator({ axis }: { axis: DockAxis }) {
  return (
    <Separator
      orientation={axis === 'vertical' ? 'horizontal' : 'vertical'}
      className={
        axis === 'vertical'
          ? 'my-1 data-horizontal:w-6'
          : 'mx-1 data-vertical:h-6 data-vertical:self-center'
      }
    />
  );
}

/** Шеврон инструмента: по клику — список вариантов, по наведению — только подсказка. */
function VariantMenu({
  tool,
  current,
  axis,
  side,
  onPick,
}: {
  tool: Tool;
  current: Variant;
  axis: DockAxis;
  side: DockSide;
  onPick: (tool: Tool, variant: Variant) => void;
}) {
  const t = useTranslations('toolRail');
  const focus = useMenuFocus();
  const toward = OPEN_TOWARD[side];

  return (
    <DropdownMenu>
      <RailTooltip label={t('variantsOf', { tool: t(`tools.${tool.id}`) })} side={toward}>
        <DropdownMenuTrigger asChild>
          <ToolbarPrimitive.Button
            aria-label={t('variantsOf', { tool: t(`tools.${tool.id}`) })}
            {...focus.trigger}
            className={cn(
              'grid shrink-0 place-items-center rounded-full outline-none',
              'text-muted-foreground/70 transition-colors duration-100 motion-reduce:transition-none',
              'hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
              'data-[state=open]:bg-muted data-[state=open]:text-foreground',
              axis === 'vertical' ? 'h-3.5 w-9' : 'h-9 w-3.5',
            )}
          >
            <HugeiconsIcon icon={CHEVRON[side]} size={10} strokeWidth={2.5} color="currentColor" />
          </ToolbarPrimitive.Button>
        </DropdownMenuTrigger>
      </RailTooltip>
      <DropdownMenuContent
        side={toward}
        align="center"
        sideOffset={10}
        aria-label={t(`tools.${tool.id}`)}
        onCloseAutoFocus={focus.onCloseAutoFocus}
        className="z-[4000] w-auto min-w-44"
      >
        <DropdownMenuRadioGroup
          value={current.id}
          onValueChange={(id) => {
            const variant = tool.variants.find((candidate) => candidate.id === id);
            if (variant) onPick(tool, variant);
          }}
        >
          {tool.variants.map((variant) => (
            <DropdownMenuRadioItem key={variant.id} value={variant.id}>
              <HugeiconsIcon icon={variant.icon} size={14} strokeWidth={1.5} color="currentColor" />
              {t(`variants.${variant.id}`)}
              <DropdownMenuShortcut>
                <Kbd>{variant.shortcut.key}</Kbd>
              </DropdownMenuShortcut>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
      onMouseDown={keepCanvasFocus}
      className={cn(
        'grid shrink-0 touch-none place-items-center rounded-full outline-none',
        'text-muted-foreground/50 transition-colors hover:text-foreground',
        'focus-visible:ring-2 focus-visible:ring-ring/50',
        axis === 'vertical' ? 'h-6 w-9' : 'h-9 w-6',
        dragging ? 'cursor-grabbing text-foreground' : 'cursor-grab',
        className,
      )}
      {...props}
      title={props.title ?? t('gripHint')}
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

/**
 * Панель инструментов. Инструмент холста — управляемое значение: его держит редактор, а
 * панель только показывает и предлагает сменить. Так редактор может сам вернуть «Выбор»
 * после вставки, и панель это увидит.
 *
 * Фокус и стрелки внутри панели — Radix Toolbar, подсказки и меню — Radix Tooltip и
 * DropdownMenu: они сами встают в сторону свободного места и не уходят за край окна.
 */
export const ToolRail = memo(function ToolRail({
  className,
  side = 'left',
  grip,
  value,
  onChange,
  onAction,
  history,
}: {
  className?: string;
  /** Край, к которому панель обращена: от него зависят ориентация и сторона окон. */
  side?: DockSide;
  /** Ручка перетаскивания. Панель только ставит её в начало ряда. */
  grip?: ReactElement;
  /** Текущий инструмент холста. */
  value: VariantId;
  onChange: (id: VariantId) => void;
  /** Кнопки панелей: открыть ассистента и т. п. Инструмент холста они не меняют. */
  onAction?: (id: RailActionId) => void;
  /** Отмена и повтор. Кнопки стоят всегда; нечего вернуть — кнопка выключена. */
  history?: RailHistory;
}) {
  const t = useTranslations('toolRail');
  const axis = dockAxis(side);
  const toward = OPEN_TOWARD[side];
  const [chosen, setChosen] = useState(DEFAULT_VARIANTS);
  const onChangeRef = useRef(onChange);
  const onActionRef = useRef(onAction);

  useEffect(() => {
    onChangeRef.current = onChange;
    onActionRef.current = onAction;
  });

  // Инструмент сменили снаружи — его вариант становится последним выбранным у своей кнопки.
  const activeTool = TOOL_BY_VARIANT.get(value);
  if (activeTool && chosen[activeTool.id] !== value) {
    setChosen((previous) => ({ ...previous, [activeTool.id]: value }));
  }

  const variantOf = (tool: Tool): Variant =>
    tool.variants.find((variant) => variant.id === chosen[tool.id]) ?? tool.variants[0];

  const pick = useCallback((tool: Tool, variant: Variant) => {
    setChosen((previous) => ({ ...previous, [tool.id]: variant.id }));
    onChangeRef.current(variant.id);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isTypingTarget(event.target)) return;
      // В открытом меню буквы ищут пункт, а не меняют инструмент.
      if (event.target instanceof Element && event.target.closest('[role="menu"]')) return;

      const hit = BY_CODE.get(event.code);
      if (!hit) return;
      event.preventDefault();
      if (hit.kind === 'action') onActionRef.current?.(hit.action.id);
      else pick(hit.tool, hit.variant);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pick]);

  const historyLabel = (id: HistoryId) => {
    const kind = history?.[id];
    return t(`history.${id}`, { change: t(`history.changes.${kind ?? 'other'}`) });
  };

  const along = axis === 'vertical' ? 'flex-col' : 'flex-row';

  return (
    <TooltipProvider>
      <ToolbarPrimitive.Root
        orientation={axis}
        aria-label={t('label')}
        className={cn(
          'flex items-center rounded-full p-1',
          axis === 'vertical' ? 'w-13 flex-col' : 'h-13 flex-row',
          'bg-card shadow-lg shadow-black/20 ring-1 ring-border',
          className,
        )}
      >
        {grip && (
          <>
            {grip}
            <RailSeparator axis={axis} />
          </>
        )}

        <ToolbarPrimitive.ToggleGroup
          type="single"
          aria-label={t('groups.canvas')}
          value={activeTool?.id ?? ''}
          onValueChange={(id) => {
            // Повторный клик по выбранной кнопке ничего не снимает: инструмент есть всегда.
            const tool = TOOL_BY_ID.get(id as ToolId);
            if (tool) pick(tool, variantOf(tool));
          }}
          className={cn('flex items-center', along)}
        >
          {TOOLS.map((tool) => {
            const variant = variantOf(tool);
            return (
              <div key={tool.id} className={cn('flex items-center p-0.5', along)}>
                <RailTooltip
                  label={t(`variants.${variant.id}`)}
                  keys={[variant.shortcut.key]}
                  side={toward}
                >
                  <ToolbarPrimitive.ToggleItem
                    value={tool.id}
                    aria-label={t(`variants.${variant.id}`)}
                    aria-keyshortcuts={variant.shortcut.key.toLowerCase()}
                    onMouseDown={keepCanvasFocus}
                    className={cn(
                      BUTTON,
                      'data-[state=on]:bg-primary data-[state=on]:text-primary-foreground',
                    )}
                  >
                    <HugeiconsIcon
                      icon={variant.icon}
                      size={18}
                      strokeWidth={1.5}
                      color="currentColor"
                    />
                  </ToolbarPrimitive.ToggleItem>
                </RailTooltip>
                {tool.variants.length > 1 && (
                  <VariantMenu
                    tool={tool}
                    current={variant}
                    axis={axis}
                    side={side}
                    onPick={pick}
                  />
                )}
              </div>
            );
          })}
        </ToolbarPrimitive.ToggleGroup>

        <RailSeparator axis={axis} />
        <div
          role="group"
          aria-label={t('groups.panels')}
          className={cn('flex items-center', along)}
        >
          {ACTIONS.map((action) => (
            <div key={action.id} className="p-0.5">
              <RailTooltip
                label={t(`tools.${action.id}`)}
                keys={[action.shortcut.key]}
                side={toward}
              >
                <ToolbarPrimitive.Button
                  aria-label={t(`tools.${action.id}`)}
                  aria-keyshortcuts={action.shortcut.key.toLowerCase()}
                  onMouseDown={keepCanvasFocus}
                  onClick={() => onActionRef.current?.(action.id)}
                  className={BUTTON}
                >
                  <HugeiconsIcon
                    icon={action.icon}
                    size={18}
                    strokeWidth={1.5}
                    color="currentColor"
                  />
                </ToolbarPrimitive.Button>
              </RailTooltip>
            </div>
          ))}
        </div>

        {history && (
          <>
            <RailSeparator axis={axis} />
            <div
              role="group"
              aria-label={t('groups.history')}
              className={cn('flex items-center', along)}
            >
              {(['undo', 'redo'] as const).map((id) => (
                <div key={id} className="p-0.5">
                  <RailTooltip label={historyLabel(id)} keys={historyKeys(id)} side={toward}>
                    <ToolbarPrimitive.Button
                      aria-label={historyLabel(id)}
                      aria-keyshortcuts={HISTORY_KEYS[id].aria}
                      disabled={history[id] === null}
                      onMouseDown={keepCanvasFocus}
                      onClick={id === 'undo' ? history.onUndo : history.onRedo}
                      className={BUTTON}
                    >
                      <HugeiconsIcon
                        icon={HISTORY_ICONS[id]}
                        size={18}
                        strokeWidth={1.5}
                        color="currentColor"
                      />
                    </ToolbarPrimitive.Button>
                  </RailTooltip>
                </div>
              ))}
            </div>
          </>
        )}
      </ToolbarPrimitive.Root>
    </TooltipProvider>
  );
});
