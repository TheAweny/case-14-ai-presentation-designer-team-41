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
import {
  AgentIcon,
  ArrowShapeIcon,
  BackIcon,
  ChartIcon,
  CircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DiagramIcon,
  GripHorizontalIcon,
  GripVerticalIcon,
  ImageIcon,
  KeyboardIcon,
  LineIcon,
  NextIcon,
  PanIcon,
  PlayIcon,
  RedoIcon,
  SelectIcon,
  SquareIcon,
  TableIcon,
  TextIcon,
  UndoIcon,
  type Icon,
} from '@/components/ui/icons';
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
import {
  ariaKeyShortcuts,
  isMacPlatform,
  shortcutKeys,
  shortcutLabel,
  type ShortcutId,
} from '@/components/editor/editor-shortcuts';
import type { ChangeKind } from '@/components/editor/use-deck-history';
import { isInsertTool, type InsertTool } from '@/components/editor/insert-element';
import { useEditorPrefs } from '@/components/editor/use-editor-prefs';

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
export type RailActionId = 'ai' | 'shortcuts' | 'present';

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

const HISTORY_ICONS: Record<HistoryId, Icon> = {
  undo: UndoIcon,
  redo: RedoIcon,
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

type Variant = { id: VariantId; icon: Icon; shortcut: Shortcut };

/**
 * Кнопка панели. Если вариантов несколько, рядом с ней шеврон: он открывает список, а сама
 * кнопка показывает последний выбранный вариант и включает его — как в Figma.
 */
type Tool = { id: ToolId; variants: readonly [Variant, ...Variant[]] };

/**
 * `shortcut` — своя клавиша без модификаторов, её слушает рейка. `registry` — сочетание из
 * общего реестра редактора: его слушает редактор, рейка только подписывает.
 */
type Action = {
  id: RailActionId;
  icon: Icon;
  shortcut: Shortcut | null;
  registry?: ShortcutId;
};

const TOOLS: readonly Tool[] = [
  {
    id: 'pointer',
    variants: [
      { id: 'select', icon: SelectIcon, shortcut: { key: 'V', code: 'KeyV' } },
      { id: 'hand', icon: PanIcon, shortcut: { key: 'H', code: 'KeyH' } },
    ],
  },
  {
    id: 'text',
    variants: [{ id: 'text', icon: TextIcon, shortcut: { key: 'T', code: 'KeyT' } }],
  },
  {
    id: 'image',
    variants: [{ id: 'image', icon: ImageIcon, shortcut: { key: 'I', code: 'KeyI' } }],
  },
  {
    id: 'shape',
    variants: [
      { id: 'rectangle', icon: SquareIcon, shortcut: { key: 'R', code: 'KeyR' } },
      { id: 'ellipse', icon: CircleIcon, shortcut: { key: 'O', code: 'KeyO' } },
      { id: 'line', icon: LineIcon, shortcut: { key: 'L', code: 'KeyL' } },
      { id: 'arrow', icon: ArrowShapeIcon, shortcut: { key: 'A', code: 'KeyA' } },
    ],
  },
  {
    id: 'data',
    variants: [
      { id: 'chart', icon: ChartIcon, shortcut: { key: 'G', code: 'KeyG' } },
      { id: 'table', icon: TableIcon, shortcut: { key: 'B', code: 'KeyB' } },
      { id: 'diagram', icon: DiagramIcon, shortcut: { key: 'S', code: 'KeyS' } },
    ],
  },
];

const ACTIONS: readonly Action[] = [
  { id: 'ai', icon: AgentIcon, shortcut: { key: 'J', code: 'KeyJ' } },
  { id: 'shortcuts', icon: KeyboardIcon, shortcut: null, registry: 'shortcuts' },
];

/** Показ с открытого слайда, как главная кнопка Google Slides. F5 — с начала, из реестра. */
const SHOW_ACTION: Action = {
  id: 'present',
  icon: PlayIcon,
  shortcut: null,
  registry: 'present-current',
};

/** Клавиши кнопки действия для подсказки: свои однобуквенные или из реестра редактора. */
function actionKeys(action: Action): readonly string[] {
  if (action.shortcut) return [action.shortcut.key];
  if (!action.registry) return [];
  const mac = isMacPlatform();
  return shortcutKeys(action.registry).map((key) => shortcutLabel([key], mac));
}

function actionAria(action: Action): string | undefined {
  if (action.shortcut) return action.shortcut.key.toLowerCase();
  return action.registry ? ariaKeyShortcuts(action.registry) : undefined;
}

/** Однобуквенные клавиши рейки — для шпаргалки редактора. */
export const RAIL_SHORTCUTS: readonly (
  | { readonly kind: 'variant'; readonly id: VariantId; readonly key: string }
  | { readonly kind: 'action'; readonly id: RailActionId; readonly key: string }
)[] = [
  ...TOOLS.flatMap((tool) =>
    tool.variants.map((variant) => ({
      kind: 'variant' as const,
      id: variant.id,
      key: variant.shortcut.key,
    })),
  ),
  ...ACTIONS.flatMap((action) =>
    action.shortcut ? [{ kind: 'action' as const, id: action.id, key: action.shortcut.key }] : [],
  ),
];

/**
 * Что можно вставить, по кнопкам рейки: текст, картинка, фигуры, данные. Нижняя панель узкого
 * экрана строит из этого своё меню — подписи и значки те же, что на рейке.
 */
export const INSERT_GROUPS: readonly (readonly { id: InsertTool; icon: Icon }[])[] = TOOLS.map(
  (tool) =>
    tool.variants.flatMap((variant) =>
      isInsertTool(variant.id) ? [{ id: variant.id, icon: variant.icon }] : [],
    ),
).filter((group) => group.length > 0);

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
  ...ACTIONS.flatMap((action) =>
    action.shortcut ? [[action.shortcut.code, { kind: 'action', action }] as const] : [],
  ),
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

const CHEVRON: Record<DockSide, Icon> = {
  left: NextIcon,
  right: BackIcon,
  top: ChevronDownIcon,
  bottom: ChevronUpIcon,
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

/**
 * Шеврон инструмента: по клику — список вариантов, по наведению — только подсказка. Стоит
 * внутри одной «пилюли» с кнопкой инструмента, как в Figma: фон выбора и наведения у них общий.
 */
function VariantMenu({
  tool,
  current,
  axis,
  side,
  active,
  onPick,
}: {
  tool: Tool;
  current: Variant;
  axis: DockAxis;
  side: DockSide;
  /** Инструмент выбран: шеврон стоит на цветной пилюле. */
  active: boolean;
  onPick: (tool: Tool, variant: Variant) => void;
}) {
  const t = useTranslations('toolRail');
  const focus = useMenuFocus();
  const toward = OPEN_TOWARD[side];
  const ChevronIcon = CHEVRON[side];

  return (
    <DropdownMenu>
      <RailTooltip label={t('variantsOf', { tool: t(`tools.${tool.id}`) })} side={toward}>
        <DropdownMenuTrigger asChild>
          <ToolbarPrimitive.Button
            aria-label={t('variantsOf', { tool: t(`tools.${tool.id}`) })}
            {...focus.trigger}
            className={cn(
              'grid shrink-0 place-items-center rounded-full outline-none',
              'transition-colors duration-100 motion-reduce:transition-none',
              'focus-visible:ring-2 focus-visible:ring-ring/50',
              active
                ? 'text-primary-foreground/75 hover:bg-primary-foreground/15 hover:text-primary-foreground data-[state=open]:bg-primary-foreground/15'
                : 'text-muted-foreground/70 hover:bg-foreground/10 hover:text-foreground data-[state=open]:bg-foreground/10 data-[state=open]:text-foreground',
              axis === 'vertical' ? 'h-4 w-9' : 'h-9 w-4',
            )}
          >
            <ChevronIcon size={10} className="[--icon-stroke:2.5]" />
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
              <variant.icon size={14} />
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
      {axis === 'vertical' ? <GripHorizontalIcon size={16} /> : <GripVerticalIcon size={16} />}
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
  // Спрятанные в настройках кнопки уходят с рейки, но их клавиши работают по-прежнему.
  const { railHidden } = useEditorPrefs();
  const tools = TOOLS.filter((tool) => !railHidden.some((id) => id === tool.id));
  const actions = ACTIONS.filter((action) => !railHidden.some((id) => id === action.id));
  const showPresent = !railHidden.includes('present');
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
      // В открытом меню буквы ищут пункт, а не меняют инструмент; окно (шпаргалка) держит
      // клавиатуру у себя, даже когда фокус на его кнопке.
      if (
        event.target instanceof Element &&
        event.target.closest('[role="menu"], [role="dialog"]')
      ) {
        return;
      }

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
          {tools.map((tool) => {
            const variant = variantOf(tool);
            const active = activeTool?.id === tool.id;
            const grouped = tool.variants.length > 1;
            return (
              <div
                key={tool.id}
                data-tool-group={grouped ? '' : undefined}
                className={cn(
                  'flex items-center',
                  along,
                  // Кнопка с вариантами и её шеврон — одна пилюля с общим фоном.
                  grouped && [
                    'm-0.5 rounded-full transition-colors duration-100 motion-reduce:transition-none',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted has-data-[state=open]:bg-muted',
                  ],
                  !grouped && 'p-0.5',
                )}
              >
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
                      // Фон наведения даёт пилюля целиком, а не одна кнопка.
                      grouped && 'hover:bg-transparent data-[state=on]:hover:bg-transparent',
                    )}
                  >
                    <variant.icon size={18} />
                  </ToolbarPrimitive.ToggleItem>
                </RailTooltip>
                {grouped && (
                  <VariantMenu
                    tool={tool}
                    current={variant}
                    axis={axis}
                    side={side}
                    active={active}
                    onPick={pick}
                  />
                )}
              </div>
            );
          })}
        </ToolbarPrimitive.ToggleGroup>

        {actions.length > 0 && <RailSeparator axis={axis} />}
        <div
          role="group"
          aria-label={t('groups.panels')}
          className={cn('flex items-center', along)}
        >
          {actions.map((action) => (
            <div key={action.id} className="p-0.5">
              <RailTooltip label={t(`tools.${action.id}`)} keys={actionKeys(action)} side={toward}>
                <ToolbarPrimitive.Button
                  aria-label={t(`tools.${action.id}`)}
                  aria-keyshortcuts={actionAria(action)}
                  onMouseDown={keepCanvasFocus}
                  onClick={() => onActionRef.current?.(action.id)}
                  className={BUTTON}
                >
                  <action.icon size={18} />
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
              {(['undo', 'redo'] as const).map((id) => {
                const HistoryIcon = HISTORY_ICONS[id];
                return (
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
                        <HistoryIcon size={18} />
                      </ToolbarPrimitive.Button>
                    </RailTooltip>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {showPresent && (
          <>
            <RailSeparator axis={axis} />
            <div role="group" aria-label={t('groups.show')} className="p-0.5">
              <RailTooltip
                label={t(`tools.${SHOW_ACTION.id}`)}
                keys={actionKeys(SHOW_ACTION)}
                side={toward}
              >
                <ToolbarPrimitive.Button
                  aria-label={t(`tools.${SHOW_ACTION.id}`)}
                  aria-keyshortcuts={actionAria(SHOW_ACTION)}
                  onMouseDown={keepCanvasFocus}
                  onClick={() => onActionRef.current?.(SHOW_ACTION.id)}
                  className={BUTTON}
                >
                  <SHOW_ACTION.icon size={18} />
                </ToolbarPrimitive.Button>
              </RailTooltip>
            </div>
          </>
        )}
      </ToolbarPrimitive.Root>
    </TooltipProvider>
  );
});
