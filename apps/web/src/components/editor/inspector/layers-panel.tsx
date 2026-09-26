'use client';

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS as DndCss } from '@dnd-kit/utilities';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  ArrowRight01Icon,
  ChartColumnIcon,
  DashedLine01Icon,
  EllipseIcon,
  GridTableIcon,
  GroupItemsIcon,
  Image01Icon,
  LockKeyholeIcon,
  LockKeyholeOpenIcon,
  ShapesIcon,
  SquareIcon,
  TextIcon,
} from '@hugeicons/core-free-icons';
import type { SlideElement, SlideIr } from '@lct/contracts';
import { cn } from '@/lib/utils';
import {
  layerRows,
  pickRows,
  revealedGroups,
  textSnippet,
  type LayerRow,
} from '@/components/editor/inspector/layer-rows';

export interface LayersPanelProps {
  slide: SlideIr | undefined;
  selectedIds: readonly string[];
  /** Выбор строк: объекты, в том числе заблокированные, — выбрать их можно только здесь. */
  onSelect: (ids: readonly string[]) => void;
  /** Строка под курсором подсвечивает свои объекты на холсте. `null` — курсор ушёл. */
  onHover: (ids: readonly string[] | null) => void;
  onLock: (ids: readonly string[], locked: boolean) => void;
  /** Перенести слой на место другого слоя той же группы: одна запись журнала. */
  onMove: (layerId: string, overId: string) => void;
}

function iconOf(row: LayerRow): IconSvgElement {
  const { node } = row;
  if (node.kind === 'group') return GroupItemsIcon;
  const element = node.element;
  switch (element.kind) {
    case 'text':
      return TextIcon;
    case 'image':
      return Image01Icon;
    case 'table':
      return GridTableIcon;
    case 'chart':
      return ChartColumnIcon;
    case 'decor':
      if (element.shape === 'line') return DashedLine01Icon;
      if (element.shape === 'ellipse') return EllipseIcon;
      if (element.shape === 'rect' || element.shape === 'round-rect') return SquareIcon;
      return ShapesIcon;
  }
}

/**
 * Панель слоёв, как Layers в Figma и «Область выделения» в PowerPoint: объекты слайда сверху
 * вниз по порядку наложения, группы — раскрывающимися узлами. Щелчок выбирает (Shift —
 * диапазон, Ctrl — добавить), перетаскивание меняет порядок среди соседей по группе, замок
 * блокирует и снимает блокировку. Заблокированное — фон и оформление шаблона — выбирается
 * только здесь: на холсте щелчок проходит сквозь него.
 */
export function LayersPanel({
  slide,
  selectedIds,
  onSelect,
  onHover,
  onLock,
  onMove,
}: LayersPanelProps) {
  const t = useTranslations('layersPanel');
  const roles = useTranslations('selectionBar.roles');
  const shapes = useTranslations('designPanel.shapes');
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);
  const dragging = useRef(false);
  const treeRef = useRef<HTMLDivElement>(null);
  const elements = useMemo(() => slide?.elements ?? [], [slide]);
  // Раскрыто то, что раскрыли, и всё, внутри чего что-то выделено.
  const expanded = useMemo(
    () => new Set([...opened, ...revealedGroups(elements, selectedIds)]),
    [elements, opened, selectedIds],
  );
  const rows = useMemo(() => layerRows(elements, expanded), [elements, expanded]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const nameOf = useCallback(
    (row: LayerRow): string => {
      const { node } = row;
      if (node.kind === 'group') return t('group');
      const element: SlideElement = node.element;
      const words = textSnippet(element);
      if (words) return words;
      if (element.kind === 'decor' && element.role === 'decoration') {
        if (element.shape === 'line') return t('line');
        if (element.shape) return shapes(element.shape);
        return t('shape');
      }
      return roles(element.role);
    },
    [roles, shapes, t],
  );

  const toggle = useCallback((id: string) => {
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const pick = (row: LayerRow, modifiers: { range: boolean; toggle: boolean }) => {
    onSelect(pickRows(rows, selectedIds, anchor.current, row.id, modifiers));
    if (!modifiers.range || anchor.current === null) anchor.current = row.id;
    setFocusId(row.id);
  };

  const focusRow = (id: string) => {
    setFocusId(id);
    treeRef.current
      ?.querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(id)}"]`)
      ?.focus({ preventScroll: false });
  };

  /** Клавиши дерева: стрелки ходят по строкам и выбирают, влево-вправо сворачивают группы. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: LayerRow) => {
    if (dragging.current || event.ctrlKey || event.metaKey || event.altKey) return;
    const at = rows.indexOf(row);
    const step = (to: number) => {
      const next = rows[to];
      if (!next) return;
      event.preventDefault();
      pick(next, { range: event.shiftKey, toggle: false });
      focusRow(next.id);
    };
    switch (event.key) {
      case 'ArrowDown':
        return step(at + 1);
      case 'ArrowUp':
        return step(at - 1);
      case 'Home':
        return step(0);
      case 'End':
        return step(rows.length - 1);
      case 'ArrowRight':
        if (row.node.kind === 'group' && !expanded.has(row.id)) {
          event.preventDefault();
          toggle(row.id);
        }
        return;
      case 'ArrowLeft': {
        event.preventDefault();
        if (row.node.kind === 'group' && opened.has(row.id)) toggle(row.id);
        else {
          const parent = rows.find((item) => item.id === row.parent.at(-1));
          if (parent) focusRow(parent.id);
        }
        return;
      }
      default:
    }
  };

  // Слой встаёт только среди соседей по группе: чужие строки для него не цели.
  const collision = useCallback<CollisionDetection>(
    (args) => {
      const parent = JSON.stringify(byId.get(String(args.active.id))?.parent ?? []);
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter(
          (container) => JSON.stringify(byId.get(String(container.id))?.parent ?? []) === parent,
        ),
      });
    },
    [byId],
  );

  const labelFor = (id: UniqueIdentifier) => {
    const row = byId.get(String(id));
    return row ? nameOf(row) : String(id);
  };

  const onDragEnd = (event: DragEndEvent) => {
    dragging.current = false;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onMove(String(active.id), String(over.id));
  };

  if (!slide) return null;
  if (rows.length === 0) {
    return <p className="px-3 py-3 text-xs text-balance text-muted-foreground">{t('empty')}</p>;
  }

  const tabStop = focusId !== null && byId.has(focusId) ? focusId : (rows[0]?.id ?? null);
  const siblingsOf = (parent: readonly string[]) =>
    rows.filter((row) => JSON.stringify(row.parent) === JSON.stringify(parent));

  const renderLevel = (parent: readonly string[]) => {
    const level = siblingsOf(parent);
    return (
      <SortableContext items={level.map((row) => row.id)} strategy={verticalListSortingStrategy}>
        {level.map((row) => (
          <LayerItem
            key={row.id}
            row={row}
            name={nameOf(row)}
            icon={iconOf(row)}
            selected={row.elementIds.every((id) => selected.has(id))}
            expanded={row.node.kind === 'group' && expanded.has(row.id)}
            focusable={row.id === tabStop}
            onPick={pick}
            onToggle={toggle}
            onHover={onHover}
            onLock={onLock}
            onKeyDown={onKeyDown}
          >
            {row.node.kind === 'group' && expanded.has(row.id) ? (
              <div role="group">{renderLevel(row.node.path)}</div>
            ) : null}
          </LayerItem>
        ))}
      </SortableContext>
    );
  };

  return (
    <div className="flex flex-col gap-1 py-2">
      <p className="px-3 pb-1 text-[11px] text-balance text-muted-foreground">{t('hint')}</p>
      <DndContext
        id="layers"
        sensors={sensors}
        collisionDetection={collision}
        accessibility={{
          screenReaderInstructions: { draggable: t('reorderHint') },
          announcements: {
            onDragStart: ({ active }) => t('dragStart', { layer: labelFor(active.id) }),
            onDragOver: ({ active, over }) =>
              over ? t('dragOver', { layer: labelFor(active.id), over: labelFor(over.id) }) : '',
            onDragEnd: ({ active, over }) =>
              over ? t('dragEnd', { layer: labelFor(active.id) }) : t('dragCancel'),
            onDragCancel: () => t('dragCancel'),
          },
        }}
        onDragStart={() => {
          dragging.current = true;
          onHover(null);
        }}
        onDragCancel={() => {
          dragging.current = false;
        }}
        onDragEnd={onDragEnd}
      >
        <div
          ref={treeRef}
          role="tree"
          aria-label={t('label')}
          aria-multiselectable
          className="flex flex-col px-1.5"
          onMouseLeave={() => onHover(null)}
        >
          {renderLevel([])}
        </div>
      </DndContext>
    </div>
  );
}

function LayerItem({
  row,
  name,
  icon,
  selected,
  expanded,
  focusable,
  onPick,
  onToggle,
  onHover,
  onLock,
  onKeyDown,
  children,
}: {
  row: LayerRow;
  name: string;
  icon: IconSvgElement;
  selected: boolean;
  expanded: boolean;
  focusable: boolean;
  onPick: (row: LayerRow, modifiers: { range: boolean; toggle: boolean }) => void;
  onToggle: (id: string) => void;
  onHover: (ids: readonly string[] | null) => void;
  onLock: (ids: readonly string[], locked: boolean) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, row: LayerRow) => void;
  children?: ReactNode;
}) {
  const t = useTranslations('layersPanel');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
  });
  const group = row.node.kind === 'group';
  const count = row.elementIds.length;
  const stop = (event: MouseEvent) => event.stopPropagation();

  return (
    <div
      ref={setNodeRef}
      style={{ transform: DndCss.Translate.toString(transform), transition }}
      className={cn('relative', isDragging && 'z-[1] opacity-80')}
    >
      <div
        role="treeitem"
        aria-level={row.depth + 1}
        aria-selected={selected}
        aria-expanded={group ? expanded : undefined}
        aria-label={row.locked ? `${name}, ${t('locked')}` : name}
        aria-describedby={attributes['aria-describedby']}
        aria-roledescription={attributes['aria-roledescription']}
        tabIndex={focusable ? 0 : -1}
        data-layer-id={row.id}
        {...listeners}
        onClick={(event) =>
          onPick(row, { range: event.shiftKey, toggle: event.ctrlKey || event.metaKey })
        }
        onKeyDown={(event) => {
          // Пробел и Enter — подъём слоя для перестановки: их слушает dnd-kit.
          listeners?.onKeyDown?.(event);
          if (!event.defaultPrevented) onKeyDown(event, row);
        }}
        onPointerEnter={() => onHover(row.elementIds)}
        style={{ paddingLeft: 6 + row.depth * 14 }}
        className={cn(
          'group/layer flex h-7 cursor-default items-center gap-1.5 rounded-md pr-1 text-xs outline-none select-none',
          'transition-colors duration-75 motion-reduce:transition-none',
          'focus-visible:ring-2 focus-visible:ring-ring/50',
          selected
            ? 'bg-[var(--canvas-selection)]/15 text-foreground'
            : 'text-foreground/90 hover:bg-muted',
        )}
      >
        {group ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={expanded ? t('collapse') : t('expand')}
            onPointerDown={stop}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(row.id);
            }}
            className="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground hover:text-foreground"
          >
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              size={12}
              strokeWidth={2}
              color="currentColor"
              className={cn(
                'transition-transform duration-100 motion-reduce:transition-none',
                expanded && 'rotate-90',
              )}
            />
          </button>
        ) : (
          <span aria-hidden className="size-4 shrink-0" />
        )}
        <HugeiconsIcon
          icon={icon}
          size={14}
          strokeWidth={1.5}
          color="currentColor"
          className="shrink-0 text-muted-foreground"
        />
        <span className={cn('min-w-0 flex-1 truncate', row.locked && 'text-muted-foreground')}>
          {name}
        </span>
        {group ? (
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {t('groupCount', { count })}
          </span>
        ) : null}
        <button
          type="button"
          tabIndex={-1}
          aria-label={row.locked ? t('unlock') : t('lock')}
          aria-pressed={row.locked}
          title={row.locked ? t('unlock') : t('lock')}
          onPointerDown={stop}
          onClick={(event) => {
            event.stopPropagation();
            onLock(row.elementIds, !row.locked);
          }}
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground outline-none',
            'hover:bg-background hover:text-foreground',
            row.locked ? 'opacity-100' : 'opacity-0 group-hover/layer:opacity-100',
          )}
        >
          <HugeiconsIcon
            icon={row.locked ? LockKeyholeIcon : LockKeyholeOpenIcon}
            size={13}
            strokeWidth={1.5}
            color="currentColor"
          />
        </button>
      </div>
      {children}
    </div>
  );
}
