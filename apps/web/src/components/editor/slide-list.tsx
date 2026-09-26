'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DesignSystem, SlideIr } from '@lct/contracts';
import { SlideView } from '@lct/slide-renderer';
import { HugeiconsIcon } from '@hugeicons/react';
import { Add01Icon, Note01Icon } from '@hugeicons/core-free-icons';
import { cn } from '@/lib/utils';
import type { SlideLayout } from '@/lib/deck-source';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { shortcutKeys, shortcutLabel } from '@/components/editor/editor-shortcuts';
import { NARROW_SCREEN, useMediaQuery } from '@/lib/use-media-query';
import {
  listKeyTarget,
  nearestScroll,
  type ListOrientation,
} from '@/components/editor/slide-navigation';
import { blockDropIndex, pickSlide, type PickModifiers } from '@/components/editor/slide-picks';
import { layoutOf, type DeckFrame } from '@/components/editor/slide-factory';
import { useEmptyTextPrompt } from '@/components/editor/empty-text';
import {
  NewSlideTiles,
  TILE_ITEM_CLASS,
  useNewSlideChoices,
  type NewSlideChoice,
} from '@/components/editor/new-slide-layouts';

const PLAIN: PickModifiers = { range: false, toggle: false };

type EmptyText = ReturnType<typeof useEmptyTextPrompt>;

/**
 * Список слайдов колоды: колонка на широком экране, горизонтальная лента на узком.
 *
 * Миниатюра — тот же слайд, что и на холсте: `SlideView` в режиме миниатюры. Он рисуется в
 * долях своей ширины, поэтому уменьшается вместе с рамкой и остаётся похожим на слайд.
 * Правка на холсте меняет один слайд колоды, и перерисовывается одна миниатюра.
 *
 * По семантике это listbox с множественным выбором, где открытый слайд идёт за фокусом: стрелки,
 * Home и End сразу открывают слайд, с Shift — ещё и расширяют выбор. Щелчок с Ctrl (Cmd)
 * добавляет слайд к выбранным, с Shift — диапазон, Ctrl+A — все. Перенос, копия и удаление
 * работают над всеми выбранными сразу, одной записью журнала. В порядке табуляции только
 * открытый слайд (roving tabindex), так что Tab проходит список за одно нажатие.
 *
 * Новый слайд — на макете шаблона. Кнопка под списком открывает галерею: пустой слайд и макеты
 * шаблона, то же — в подменю списка. Ctrl+M и пункт «Новый слайд» берут макет открытого слайда,
 * как в Google Slides; у пустого слайда или без макета — пустой.
 *
 * Порядок меняет dnd-kit: мышь сдвигает миниатюру после короткого пути, палец — после удержания,
 * чтобы смахивание ленты на узком экране оставалось прокруткой. Пробел берёт слайд с клавиатуры,
 * и только тогда стрелки переставляют его, а не открывают соседний. Выбранные слайды едут
 * вместе с тем, за который взялись.
 */
export function SlideList({
  slides,
  layouts,
  designSystem,
  labels,
  current,
  resolveMedia,
  onSelect,
  onMove,
  onAdd,
  onDuplicate,
  onRemove,
  className,
}: {
  slides: readonly SlideIr[];
  /** Макеты шаблона для нового слайда. */
  layouts: readonly SlideLayout[];
  designSystem: DesignSystem;
  /** Подписи слайдов для чтения с экрана, по одной на слайд. */
  labels: readonly string[];
  current: number;
  /** Адрес картинки по `mediaPart` — тот же, что у холста. */
  resolveMedia?: (mediaPart: string) => string | null;
  onSelect: (index: number) => void;
  /**
   * Перенести слайды блоком: `index` — место блока среди остальных слайдов. Отмена
   * возвращает прежний порядок.
   */
  onMove: (slideIds: readonly string[], index: number) => void;
  /** Новый слайд после слайда с этим индексом: на макете шаблона или пустой (`null`). */
  onAdd: (after: number, layout: SlideLayout | null) => void;
  /** Копии выбранных слайдов; возвращает id копий, чтобы выбрать их. */
  onDuplicate: (slideIds: readonly string[]) => readonly string[];
  /** Последний слайд не удаляется: колода без слайдов — не колода. */
  onRemove: (slideIds: readonly string[]) => void;
  className?: string;
}) {
  const t = useTranslations('editor');
  const many = useTranslations('slideList');
  const listRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const order = useMemo(() => slides.map((slide) => slide.slideId), [slides]);
  const currentId = order[current] ?? null;
  // Выбор — id слайдов. Открытый слайд в нём всегда: если слайд открыли не отсюда (клавишами
  // с холста, по ссылке), выбор сходится к нему одному.
  const [picks, setPicks] = useState<{ picked: readonly string[]; anchor: string | null }>({
    picked: [],
    anchor: null,
  });
  const collapsed = currentId === null || !picks.picked.includes(currentId);
  const selection = useMemo(() => {
    if (currentId === null) return [];
    return collapsed ? [currentId] : order.filter((id) => picks.picked.includes(id));
  }, [collapsed, currentId, order, picks.picked]);
  const anchor = collapsed ? currentId : (picks.anchor ?? currentId);
  const picked = useMemo(() => new Set(selection), [selection]);

  const pick = useCallback(
    (index: number, modifiers: PickModifiers) => {
      const id = order[index];
      if (!id) return;
      const next = pickSlide(order, { picked: selection, anchor }, id, modifiers);
      setPicks({ picked: next.picked, anchor: next.anchor });
      const open = order.indexOf(next.open);
      if (open >= 0) onSelect(open);
    },
    [anchor, onSelect, order, selection],
  );

  const opened = slides[current];
  const addSame = useCallback(() => {
    onAdd(current, opened ? layoutOf(opened, layouts) : null);
  }, [current, layouts, onAdd, opened]);
  const addFrom = useCallback(
    (choice: NewSlideChoice) => onAdd(current, choice.layout),
    [current, onAdd],
  );
  // Размер и вариант у слайдов колоды общие: пустой слайд берёт их у первого.
  const first = slides[0];
  const variant = first?.variant;
  const slideCx = first?.slideCx;
  const slideCy = first?.slideCy;
  const frame = useMemo<DeckFrame | undefined>(
    () => (variant && slideCx && slideCy ? { variant, slideCx, slideCy } : undefined),
    [slideCx, slideCy, variant],
  );
  const choices = useNewSlideChoices(layouts, frame);
  const emptyText = useEmptyTextPrompt();

  const duplicatePicked = useCallback(() => {
    const copies = onDuplicate(selection);
    if (copies.length > 0) setPicks({ picked: copies, anchor: copies[0] ?? null });
  }, [onDuplicate, selection]);
  const removePicked = useCallback(() => {
    if (selection.length > 0 && selection.length < slides.length) onRemove(selection);
  }, [onRemove, selection, slides.length]);
  /** Что едет, когда тянут этот слайд: все выбранные, если он среди них, иначе он один. */
  const movingWith = useCallback(
    (id: UniqueIdentifier): readonly string[] =>
      picked.has(String(id)) ? selection : [String(id)],
    [picked, selection],
  );
  const reduceMotion = useReducedMotion() === true;
  const orientation: ListOrientation = useMediaQuery(NARROW_SCREEN) ? 'horizontal' : 'vertical';
  /** В какой ориентации список уже прокручивали: `null` до первого показа. */
  const scrolledRef = useRef<ListOrientation | null>(null);
  const digits = String(slides.length).length;
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const labelFor = useCallback(
    (id: UniqueIdentifier) => {
      const index = slides.findIndex((slide) => slide.slideId === id);
      return index < 0 ? String(id) : (labels[index] ?? String(id));
    },
    [labels, slides],
  );

  /**
   * Открытый слайд всегда виден в списке, откуда бы его ни открыли: клавишами, с холста или по
   * ссылке. Фокус переезжает следом, только если он уже был в списке, — PageDown над холстом
   * фокус не отнимает. Первый показ и смена ориентации прокручивают сразу: следить глазу там
   * не за чем.
   *
   * Прокручиваем сам список, а не `scrollIntoView`: тот в Chrome переносит точку, от которой
   * считает Tab, и первый Tab на странице проскакивал бы открытый слайд.
   */
  useEffect(() => {
    const list = listRef.current;
    const option = list?.querySelector<HTMLElement>(`[data-index="${current}"]`);
    if (!list || !option) return;
    if (list.contains(document.activeElement) && document.activeElement !== option) {
      option.focus({ preventScroll: true });
    }
    const across = orientation === 'horizontal';
    const box = list.getBoundingClientRect();
    const rect = option.getBoundingClientRect();
    const style = getComputedStyle(option);
    const scroll = across ? list.scrollLeft : list.scrollTop;
    const target = nearestScroll(
      { start: scroll, size: across ? list.clientWidth : list.clientHeight },
      {
        start: across
          ? rect.left - box.left - list.clientLeft + scroll
          : rect.top - box.top - list.clientTop + scroll,
        size: across ? rect.width : rect.height,
      },
      // Поле берём из `scroll-margin` строки: оно же работает и при прокрутке браузером.
      parseFloat(across ? style.scrollMarginLeft : style.scrollMarginTop) || 0,
    );
    if (target !== scroll) {
      const animate = scrolledRef.current === orientation && !reduceMotion;
      list.scrollTo({
        [across ? 'left' : 'top']: target,
        behavior: animate ? 'smooth' : 'instant',
      });
    }
    scrolledRef.current = orientation;
  }, [current, orientation, reduceMotion, slides]);

  const onDragEnd = (event: DragEndEvent) => {
    dragging.current = false;
    setDraggingId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const moving = movingWith(active.id);
    const index = blockDropIndex(order, moving, String(active.id), String(over.id));
    if (index !== null) onMove(moving, index);
  };
  const carried = draggingId === null ? [] : movingWith(draggingId);

  return (
    // Свой `id`: иначе dnd-kit берёт номер из сквозного счётчика, и подписи для чтения с
    // экрана на сервере и в браузере расходятся — гидратация ругается на каждую загрузку.
    <DndContext
      id="slide-list"
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{
        screenReaderInstructions: { draggable: t('reorderHint') },
        announcements: {
          onDragStart: ({ active }) => {
            const count = movingWith(active.id).length;
            return count > 1
              ? many('dragStartMany', { count })
              : t('dragStart', { slide: labelFor(active.id) });
          },
          onDragOver: ({ active, over }) =>
            over
              ? t('dragOver', { slide: labelFor(active.id), over: labelFor(over.id) })
              : undefined,
          onDragEnd: ({ active, over }) => {
            if (!over) return t('dragCancel');
            const count = movingWith(active.id).length;
            return count > 1
              ? many('dragEndMany', { count })
              : t('dragEnd', { slide: labelFor(active.id) });
          },
          onDragCancel: () => t('dragCancel'),
        },
      }}
      onDragStart={({ active }) => {
        dragging.current = true;
        setDraggingId(String(active.id));
      }}
      onDragCancel={() => {
        dragging.current = false;
        setDraggingId(null);
      }}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={slides.map((slide) => slide.slideId)}
        strategy={
          orientation === 'horizontal' ? horizontalListSortingStrategy : verticalListSortingStrategy
        }
      >
        <ContextMenu modal={false}>
          <ContextMenuTrigger asChild>
            <div
              ref={listRef}
              role="listbox"
              aria-label={t('slides')}
              aria-orientation={orientation}
              aria-multiselectable
              onKeyDown={(event) => {
                // Пока слайд поднят с клавиатуры, стрелки принадлежат перестановке.
                if (dragging.current) return;
                const action = slideKeyAction(event);
                if (action) {
                  event.preventDefault();
                  if (action === 'add') addSame();
                  if (action === 'duplicate') duplicatePicked();
                  if (action === 'remove') removePicked();
                  if (action === 'select-all') setPicks({ picked: order, anchor: currentId });
                  return;
                }
                if (event.ctrlKey || event.metaKey || event.altKey) return;
                const target = listKeyTarget(event.key, current, slides.length, orientation);
                if (target === null) return;
                event.preventDefault();
                // С Shift стрелки расширяют выбор от якоря, как в Google Slides.
                pick(target, { range: event.shiftKey, toggle: false });
              }}
              className={cn(
                'flex gap-1 overscroll-contain p-2 [scrollbar-width:thin]',
                'max-md:overflow-x-auto md:flex-col md:overflow-y-auto',
                className,
              )}
            >
              {slides.map((slide, index) => (
                <SortableSlide
                  key={slide.slideId}
                  slide={slide}
                  designSystem={designSystem}
                  label={labels[index] ?? ''}
                  index={index}
                  current={index === current}
                  selected={picked.has(slide.slideId)}
                  carried={
                    carried.length > 1 &&
                    draggingId !== slide.slideId &&
                    carried.includes(slide.slideId)
                  }
                  count={draggingId === slide.slideId ? carried.length : 0}
                  digits={digits}
                  resolveMedia={resolveMedia}
                  emptyText={emptyText}
                  onPick={pick}
                />
              ))}
            </div>
          </ContextMenuTrigger>
          <SlideMenu
            count={selection.length}
            canRemove={selection.length < slides.length}
            choices={choices}
            designSystem={designSystem}
            resolveMedia={resolveMedia}
            onAdd={addSame}
            onAddFrom={addFrom}
            onDuplicate={duplicatePicked}
            onRemove={removePicked}
          />
        </ContextMenu>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'mx-2 mb-2 flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg text-xs',
                'text-muted-foreground outline-none ring-1 ring-border ring-inset',
                'transition-colors duration-100 motion-reduce:transition-none',
                'hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                'data-[state=open]:bg-muted data-[state=open]:text-foreground',
              )}
            >
              <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={1.75} color="currentColor" />
              {t('addSlide')}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            // В колонке галерея встаёт справа от списка, над холстом; в ленте — над лентой.
            side={orientation === 'horizontal' ? 'top' : 'right'}
            align="end"
            className="w-[min(22rem,calc(100vw-2rem))] p-1.5"
          >
            <DropdownMenuLabel>{many('newSlideLayouts')}</DropdownMenuLabel>
            <NewSlideTiles
              choices={choices}
              designSystem={designSystem}
              resolveMedia={resolveMedia}
              item={(choice, tile) => (
                <DropdownMenuItem
                  key={choice.key}
                  className={TILE_ITEM_CLASS}
                  onSelect={() => addFrom(choice)}
                >
                  {tile}
                </DropdownMenuItem>
              )}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </SortableContext>
    </DndContext>
  );
}

type SlideAction = 'add' | 'duplicate' | 'remove' | 'select-all';

/**
 * Клавиши списка: как в Google Slides — Ctrl+M новый слайд, Ctrl+D копия, Delete удалить,
 * Ctrl+A выбрать все слайды.
 */
function slideKeyAction(event: {
  code: string;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): SlideAction | null {
  if (event.altKey || event.shiftKey) return null;
  const command = event.ctrlKey || event.metaKey;
  if (command && event.code === 'KeyM') return 'add';
  if (command && event.code === 'KeyD') return 'duplicate';
  if (command && event.code === 'KeyA') return 'select-all';
  if (!command && (event.key === 'Delete' || event.key === 'Backspace')) return 'remove';
  return null;
}

function SlideMenu({
  count,
  canRemove,
  choices,
  designSystem,
  resolveMedia,
  onAdd,
  onAddFrom,
  onDuplicate,
  onRemove,
}: {
  /** Сколько слайдов выбрано: копия и удаление — над всеми. */
  count: number;
  canRemove: boolean;
  choices: readonly NewSlideChoice[];
  designSystem: DesignSystem;
  resolveMedia?: (mediaPart: string) => string | null;
  /** Новый слайд на макете открытого. */
  onAdd: () => void;
  onAddFrom: (choice: NewSlideChoice) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations('editor');
  const many = useTranslations('slideList');
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <ContextMenuContent>
      <ContextMenuItem onSelect={onAdd}>
        {t('addSlide')}
        <ContextMenuShortcut>{shortcutLabel(shortcutKeys('slide-new'), mac)}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger>{many('newSlideFrom')}</ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-[min(22rem,calc(100vw-2rem))] p-1.5">
          <NewSlideTiles
            choices={choices}
            designSystem={designSystem}
            resolveMedia={resolveMedia}
            item={(choice, tile) => (
              <ContextMenuItem
                key={choice.key}
                className={TILE_ITEM_CLASS}
                onSelect={() => onAddFrom(choice)}
              >
                {tile}
              </ContextMenuItem>
            )}
          />
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem onSelect={onDuplicate}>
        {count > 1 ? many('duplicateSlides', { count }) : t('duplicateSlide')}
        <ContextMenuShortcut>{shortcutLabel(['Mod', 'D'], mac)}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" disabled={!canRemove} onSelect={onRemove}>
        {count > 1 ? many('removeSlides', { count }) : t('removeSlide')}
        <ContextMenuShortcut>{shortcutLabel(shortcutKeys('remove'), mac)}</ContextMenuShortcut>
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

/**
 * Сам рисунок слайда. Отдельный мемо-компонент: пока меняется соседний слайд, выделение или
 * порядок, эта миниатюра не перерисовывается. Правка объекта на холсте создаёт новый слайд —
 * и тогда перерисовывается только он.
 */
const Thumbnail = memo(function Thumbnail({
  slide,
  designSystem,
  resolveMedia,
  emptyText,
}: {
  slide: SlideIr;
  designSystem: DesignSystem;
  resolveMedia?: (mediaPart: string) => string | null;
  emptyText: EmptyText;
}) {
  return (
    <SlideView
      slide={slide}
      profile={designSystem}
      resolveMedia={resolveMedia}
      emptyText={emptyText}
      thumbnail
    />
  );
});

const SortableSlide = memo(function SortableSlide({
  slide,
  designSystem,
  label,
  index,
  current,
  selected,
  carried,
  count,
  digits,
  resolveMedia,
  emptyText,
  onPick,
}: {
  slide: SlideIr;
  designSystem: DesignSystem;
  label: string;
  index: number;
  /** Открытый слайд: на нём фокус и самая яркая рамка. */
  current: boolean;
  /** Среди выбранных. */
  selected: boolean;
  /** Едет вместе с перетаскиваемым слайдом: на своём месте он бледнеет. */
  carried: boolean;
  /** Сколько слайдов тянут вместе с этим; больше одного — значок со счётом. */
  count: number;
  digits: number;
  resolveMedia?: (mediaPart: string) => string | null;
  emptyText: EmptyText;
  onPick: (index: number, modifiers: PickModifiers) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: slide.slideId,
  });
  const notes = useTranslations('speakerNotes');
  // Значок заметок у номера, как в PowerPoint: видно, к каким слайдам докладчик что-то записал.
  const hasNotes = (slide.notes ?? '').trim() !== '';

  return (
    // Номер стоит поперёк списка — слева в колонке, сверху в ленте, — чтобы миниатюры
    // шли вдоль него вплотную и не делили с номерами длину прокрутки.
    <div
      ref={setNodeRef}
      role="option"
      aria-selected={selected}
      aria-label={label}
      aria-describedby={attributes['aria-describedby']}
      aria-roledescription={attributes['aria-roledescription']}
      aria-description={hasNotes ? notes('has') : undefined}
      tabIndex={current ? 0 : -1}
      data-index={index}
      data-has-notes={hasNotes ? '' : undefined}
      data-slide-id={slide.slideId}
      data-current={current ? '' : undefined}
      {...listeners}
      onClick={(event) =>
        onPick(index, { range: event.shiftKey, toggle: event.ctrlKey || event.metaKey })
      }
      // Правый щелчок по выбранному не сбрасывает выбор: меню — для всех выбранных.
      onContextMenu={() => {
        if (!selected) onPick(index, PLAIN);
      }}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn(
        'group/slide relative flex shrink-0 cursor-grab scroll-m-2 rounded-lg p-1 outline-none',
        'gap-1 select-none max-md:flex-col md:gap-2',
        'active:cursor-grabbing',
        isDragging && 'z-[1] cursor-grabbing opacity-80',
        carried && 'opacity-40',
      )}
    >
      <span
        aria-hidden
        // Колонка номеров шириной в самый длинный номер колоды: миниатюры стоят ровно.
        style={{ width: `${digits}ch` }}
        className={cn(
          'flex shrink-0 gap-1 pt-0.5 text-[0.6875rem] leading-4 tabular-nums',
          'max-md:items-center md:flex-col md:items-end md:text-right',
          'text-muted-foreground transition-colors group-hover/slide:text-foreground',
          'group-aria-selected/slide:text-foreground',
        )}
      >
        {index + 1}
        {hasNotes ? (
          <span data-notes-mark="" title={notes('has')} className="grid place-items-center">
            <HugeiconsIcon icon={Note01Icon} size={11} strokeWidth={1.75} color="currentColor" />
          </span>
        ) : null}
      </span>
      {count > 1 ? (
        <span
          aria-hidden
          className="absolute -top-1 -right-1 z-[2] grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[0.6875rem] font-medium text-primary-foreground tabular-nums shadow-sm"
        >
          {count}
        </span>
      ) : null}
      {/*
       * Размер миниатюры задаёт ось списка: в колонке — ширина, в ленте — высота. Вторую
       * сторону даёт пропорция самого слайда, какой бы она ни была у шаблона.
       */}
      <div
        style={{ aspectRatio: `${slide.slideCx} / ${slide.slideCy}` }}
        className={cn(
          'overflow-hidden rounded-md bg-card ring-1 ring-border',
          'transition-[box-shadow] duration-150 motion-reduce:transition-none',
          'group-hover/slide:ring-foreground/30',
          // Выбранные — рамкой потише, открытый — яркой.
          'group-aria-selected/slide:ring-2 group-aria-selected/slide:ring-primary/45',
          'group-data-current/slide:ring-2 group-data-current/slide:ring-primary',
          'group-focus-visible/slide:ring-2 group-focus-visible/slide:ring-ring',
          'max-md:h-16 md:min-w-0 md:flex-1',
        )}
      >
        <Thumbnail
          slide={slide}
          designSystem={designSystem}
          resolveMedia={resolveMedia}
          emptyText={emptyText}
        />
      </div>
    </div>
  );
});
