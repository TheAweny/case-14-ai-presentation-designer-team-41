'use client';

import { memo, useCallback, useEffect, useRef } from 'react';
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
import { Add01Icon } from '@hugeicons/core-free-icons';
import { cn } from '@/lib/utils';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { shortcutKeys, shortcutLabel } from '@/components/editor/editor-shortcuts';
import { NARROW_SCREEN, useMediaQuery } from '@/lib/use-media-query';
import {
  listKeyTarget,
  nearestScroll,
  type ListOrientation,
} from '@/components/editor/slide-navigation';

/**
 * Список слайдов колоды: колонка на широком экране, горизонтальная лента на узком.
 *
 * Миниатюра — тот же слайд, что и на холсте: `SlideView` в режиме миниатюры. Он рисуется в
 * долях своей ширины, поэтому уменьшается вместе с рамкой и остаётся похожим на слайд.
 * Правка на холсте меняет один слайд колоды, и перерисовывается одна миниатюра.
 *
 * По семантике это listbox с одиночным выбором, где выбор идёт за фокусом: стрелки, Home и End
 * сразу открывают слайд. В порядке табуляции только открытый слайд (roving tabindex), так что
 * Tab проходит список за одно нажатие.
 *
 * Порядок меняет dnd-kit: мышь сдвигает миниатюру после короткого пути, палец — после удержания,
 * чтобы смахивание ленты на узком экране оставалось прокруткой. Пробел берёт слайд с клавиатуры,
 * и только тогда стрелки переставляют его, а не открывают соседний.
 */
export function SlideList({
  slides,
  designSystem,
  labels,
  current,
  resolveMedia,
  onSelect,
  onReorder,
  onAdd,
  onDuplicate,
  onRemove,
  className,
}: {
  slides: readonly SlideIr[];
  designSystem: DesignSystem;
  /** Подписи слайдов для чтения с экрана, по одной на слайд. */
  labels: readonly string[];
  current: number;
  /** Адрес картинки по `mediaPart` — тот же, что у холста. */
  resolveMedia?: (mediaPart: string) => string | null;
  onSelect: (index: number) => void;
  /** Индексы до перестановки. Отмена возвращает прежний порядок. */
  onReorder: (from: number, to: number) => void;
  /** Новый слайд после слайда с этим индексом. */
  onAdd: (after: number) => void;
  onDuplicate: (index: number) => void;
  /** Последний слайд не удаляется: колода без слайдов — не колода. */
  onRemove: (index: number) => void;
  className?: string;
}) {
  const t = useTranslations('editor');
  const listRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
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
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = slides.findIndex((slide) => slide.slideId === active.id);
    const to = slides.findIndex((slide) => slide.slideId === over.id);
    if (from < 0 || to < 0 || from === to) return;
    onReorder(from, to);
  };

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
          onDragStart: ({ active }) => t('dragStart', { slide: labelFor(active.id) }),
          onDragOver: ({ active, over }) =>
            over
              ? t('dragOver', { slide: labelFor(active.id), over: labelFor(over.id) })
              : undefined,
          onDragEnd: ({ active, over }) =>
            over ? t('dragEnd', { slide: labelFor(active.id) }) : t('dragCancel'),
          onDragCancel: () => t('dragCancel'),
        },
      }}
      onDragStart={() => {
        dragging.current = true;
      }}
      onDragCancel={() => {
        dragging.current = false;
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
              onKeyDown={(event) => {
                // Пока слайд поднят с клавиатуры, стрелки принадлежат перестановке.
                if (dragging.current) return;
                const action = slideKeyAction(event);
                if (action) {
                  event.preventDefault();
                  if (action === 'add') onAdd(current);
                  if (action === 'duplicate') onDuplicate(current);
                  if (action === 'remove' && slides.length > 1) onRemove(current);
                  return;
                }
                const target = listKeyTarget(event.key, current, slides.length, orientation);
                if (target === null) return;
                event.preventDefault();
                onSelect(target);
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
                  selected={index === current}
                  digits={digits}
                  resolveMedia={resolveMedia}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </ContextMenuTrigger>
          <SlideMenu
            canRemove={slides.length > 1}
            onAdd={() => onAdd(current)}
            onDuplicate={() => onDuplicate(current)}
            onRemove={() => onRemove(current)}
          />
        </ContextMenu>
        <button
          type="button"
          onClick={() => onAdd(current)}
          className={cn(
            'mx-2 mb-2 flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg text-xs',
            'text-muted-foreground outline-none ring-1 ring-border ring-inset',
            'transition-colors duration-100 motion-reduce:transition-none',
            'hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={1.75} color="currentColor" />
          {t('addSlide')}
        </button>
      </SortableContext>
    </DndContext>
  );
}

type SlideAction = 'add' | 'duplicate' | 'remove';

/** Клавиши списка: как в Google Slides — Ctrl+M новый слайд, Ctrl+D копия, Delete удалить. */
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
  if (!command && (event.key === 'Delete' || event.key === 'Backspace')) return 'remove';
  return null;
}

function SlideMenu({
  canRemove,
  onAdd,
  onDuplicate,
  onRemove,
}: {
  canRemove: boolean;
  onAdd: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations('editor');
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <ContextMenuContent>
      <ContextMenuItem onSelect={onAdd}>
        {t('addSlide')}
        <ContextMenuShortcut>{shortcutLabel(shortcutKeys('slide-new'), mac)}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={onDuplicate}>
        {t('duplicateSlide')}
        <ContextMenuShortcut>{shortcutLabel(['Mod', 'D'], mac)}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" disabled={!canRemove} onSelect={onRemove}>
        {t('removeSlide')}
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
}: {
  slide: SlideIr;
  designSystem: DesignSystem;
  resolveMedia?: (mediaPart: string) => string | null;
}) {
  return <SlideView slide={slide} profile={designSystem} resolveMedia={resolveMedia} thumbnail />;
});

const SortableSlide = memo(function SortableSlide({
  slide,
  designSystem,
  label,
  index,
  selected,
  digits,
  resolveMedia,
  onSelect,
}: {
  slide: SlideIr;
  designSystem: DesignSystem;
  label: string;
  index: number;
  selected: boolean;
  digits: number;
  resolveMedia?: (mediaPart: string) => string | null;
  onSelect: (index: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: slide.slideId,
  });

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
      tabIndex={selected ? 0 : -1}
      data-index={index}
      data-slide-id={slide.slideId}
      {...listeners}
      onClick={() => onSelect(index)}
      onContextMenu={() => onSelect(index)}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn(
        'group/slide flex shrink-0 cursor-grab scroll-m-2 rounded-lg p-1 outline-none',
        'gap-1 max-md:flex-col md:gap-2',
        'active:cursor-grabbing',
        isDragging && 'z-[1] cursor-grabbing opacity-80',
      )}
    >
      <span
        aria-hidden
        // Колонка номеров шириной в самый длинный номер колоды: миниатюры стоят ровно.
        style={{ width: `${digits}ch` }}
        className={cn(
          'shrink-0 pt-0.5 text-[0.6875rem] leading-4 tabular-nums md:text-right',
          'text-muted-foreground transition-colors group-hover/slide:text-foreground',
          'group-aria-selected/slide:text-foreground',
        )}
      >
        {index + 1}
      </span>
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
          'group-aria-selected/slide:ring-2 group-aria-selected/slide:ring-primary',
          'group-focus-visible/slide:ring-2 group-focus-visible/slide:ring-ring',
          'max-md:h-16 md:min-w-0 md:flex-1',
        )}
      >
        <Thumbnail slide={slide} designSystem={designSystem} resolveMedia={resolveMedia} />
      </div>
    </div>
  );
});
