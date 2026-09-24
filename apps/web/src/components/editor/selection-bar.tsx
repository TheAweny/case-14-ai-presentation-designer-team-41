'use client';

import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useTransformEffect } from 'react-zoom-pan-pinch';
import { useTranslations } from 'next-intl';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  AlignBottomIcon,
  AlignHorizontalCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  AlignTopIcon,
  AlignVerticalCenterIcon,
  Delete02Icon,
} from '@hugeicons/core-free-icons';
import type { ColorRole, DesignSystem, SlideElement, SlideIr, TypeRole } from '@lct/contracts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { placeSelectionBar, unionBox, type Alignment } from '@/components/editor/slide-geometry';
import { cn } from '@/lib/utils';

/** Зазор между полосой и выделением — и между полосой и краем видимой области. */
const GAP = 8;
const FADE = { duration: 0.12, ease: 'easeOut' } as const;

const ALIGNMENTS: readonly { id: Alignment; icon: IconSvgElement }[] = [
  { id: 'left', icon: AlignLeftIcon },
  { id: 'center', icon: AlignHorizontalCenterIcon },
  { id: 'right', icon: AlignRightIcon },
  { id: 'top', icon: AlignTopIcon },
  { id: 'middle', icon: AlignVerticalCenterIcon },
  { id: 'bottom', icon: AlignBottomIcon },
];

type Placement = { x: number; y: number; below: boolean };

type TextElement = Extract<SlideElement, { kind: 'text' }>;

function shared<T>(values: readonly T[]): T | null {
  const first = values[0];
  if (first === undefined || values.some((value) => value !== first)) return null;
  return first;
}

function TextStyle({
  element,
  designSystem,
  side,
  onFontSize,
  onColor,
}: {
  element: TextElement;
  designSystem: DesignSystem;
  side: 'top' | 'bottom';
  onFontSize: (sizePt: number) => void;
  onColor: (role: ColorRole, hex: string) => void;
}) {
  const t = useTranslations('selectionBar');
  const runs = element.paragraphs.flatMap((paragraph) => paragraph.runs);
  const size = shared(runs.map((run) => run.sizePt));
  const color = shared(runs.map((run) => run.color.toLowerCase()));
  const sizes = designSystem.typeScale.filter(
    (entry, index, all) => all.findIndex((other) => other.role === entry.role) === index,
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <MenuTrigger label={t('size')} side={side}>
            {size ?? t('size')}
          </MenuTrigger>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="z-[4000] min-w-44">
          {sizes.map((entry) => (
            <DropdownMenuItem key={entry.role} onSelect={() => onFontSize(entry.sizePt)}>
              {t(`type.${entry.role as TypeRole}`)}
              <span className="ml-auto pl-3 text-muted-foreground tabular-nums">
                {entry.sizePt}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <MenuTrigger label={t('color')} side={side}>
            <Swatch hex={color && /^[0-9a-f]{6}$/.test(color) ? color : 'transparent'} />
          </MenuTrigger>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="z-[4000] min-w-44">
          {designSystem.palette.map((entry) => (
            <DropdownMenuItem key={entry.role} onSelect={() => onColor(entry.role, entry.hex)}>
              <Swatch hex={entry.hex} />
              {t(`palette.${entry.role}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function MenuTrigger({
  label,
  side,
  children,
}: {
  label: string;
  side: 'top' | 'bottom';
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground tabular-nums outline-none',
            'hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}

function Swatch({ hex }: { hex: string }) {
  return (
    <span
      aria-hidden
      className="size-3 shrink-0 rounded-full ring-1 ring-foreground/20"
      style={{ background: hex === 'transparent' ? 'transparent' : `#${hex}` }}
    />
  );
}

function BarButton({
  icon,
  label,
  keys,
  side,
  tone,
  onClick,
}: {
  icon: IconSvgElement;
  label: string;
  keys?: readonly string[];
  /** Подсказка открывается в сторону от выделения, чтобы не закрывать его. */
  side: 'top' | 'bottom';
  tone?: 'danger';
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none',
            'transition-colors duration-100 motion-reduce:transition-none',
            'hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
            tone === 'danger' && 'hover:text-destructive',
          )}
        >
          <HugeiconsIcon icon={icon} size={16} strokeWidth={1.5} color="currentColor" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side}>
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
 * Полоса свойств у выделения: стоит над ним, а если сверху не хватает места — под ним, и не
 * выходит за видимую область холста. У каждого нового выделения она появляется заново, а пока
 * рамку тащат или тянут за ручку, её нет: под ней меняется сама рамка.
 *
 * Полоса живёт в экранном слое поверх холста, вне трансформа зума: её размер не зависит от
 * масштаба, а место считается по экранному прямоугольнику выделения.
 *
 * Здесь только правки, которые движок умеет применить к .pptx. Кнопки под то, чего в
 * контракте правок нет, сюда не ставим: в редакторе правка была бы, а в файле — нет.
 */
export function SelectionBar({
  overlay,
  slideRoot,
  slide,
  designSystem,
  selectedIds,
  hidden,
  onRemove,
  onAlign,
  onFontSize,
  onColor,
}: {
  /** Экранный слой поверх видимой области холста: полоса лежит в его пикселях. */
  overlay: HTMLElement;
  /** Кадр открытого слайда: от его экранного прямоугольника считается выделение. */
  slideRoot: HTMLElement;
  slide: SlideIr;
  designSystem: DesignSystem;
  selectedIds: readonly string[];
  hidden: boolean;
  onRemove: () => void;
  onAlign: (alignment: Alignment) => void;
  /** Кегль из шкалы шаблона — один `set-font-size` на весь текстовый объект. */
  onFontSize: (elementId: string, sizePt: number) => void;
  /** Роль палитры. В runs пишется её hex, в журнал — сама роль. */
  onColor: (elementId: string, colorRole: ColorRole, hex: string) => void;
}) {
  const t = useTranslations('selectionBar');
  const reduceMotion = useReducedMotion() === true;
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [resized, setResized] = useState(0);
  const selected = slide.elements.filter((element) => selectedIds.includes(element.elementId));
  const bump = useCallback(() => setResized((count) => count + 1), []);

  // Лист и область меняют размер вместе с окном и панелями — полоса едет следом. Сама полоса
  // тоже может сменить размер уже после первого замера, и тогда её надо поставить заново.
  // Масштаб и пан не меняют layout-размер листа, поэтому зум сообщает о себе отдельно.
  useEffect(() => {
    const observer = new ResizeObserver(() => bump());
    observer.observe(overlay);
    observer.observe(slideRoot);
    if (bar) observer.observe(bar);
    return () => observer.disconnect();
  }, [overlay, slideRoot, bar, bump]);
  useTransformEffect(bump);

  // До отрисовки: полоса не должна мелькнуть на прежнем месте. Всё в экранных пикселях слоя:
  // прямоугольник листа уже включает зум и пан, выделение — его доля по рамкам из IR.
  useLayoutEffect(() => {
    const bounds = unionBox(
      slide.elements
        .filter((element) => selectedIds.includes(element.elementId))
        .map((element) => element.box),
    );
    if (!bar || !bounds || hidden) return;
    const origin = overlay.getBoundingClientRect();
    const sheet = slideRoot.getBoundingClientRect();
    const scaleX = sheet.width / slide.slideCx;
    const scaleY = sheet.height / slide.slideCy;
    const next = placeSelectionBar(
      {
        x: sheet.left - origin.left + bounds.x * scaleX,
        y: sheet.top - origin.top + bounds.y * scaleY,
        width: bounds.cx * scaleX,
        height: bounds.cy * scaleY,
      },
      { width: bar.offsetWidth, height: bar.offsetHeight },
      { x: 0, y: 0, width: origin.width, height: origin.height },
      GAP,
    );
    setPlacement((previous) =>
      previous?.x === next.x && previous.y === next.y && previous.below === next.below
        ? previous
        : next,
    );
  }, [overlay, slideRoot, bar, slide, selectedIds, hidden, resized]);

  if (selected.length === 0 || hidden) return null;
  const single = selected.length === 1 ? selected[0] : undefined;
  const side = placement?.below ? 'bottom' : 'top';

  return (
    <TooltipProvider>
      <motion.div
        // Новое выделение — новая полоса: она проявляется у своего объекта, а не едет от старого.
        key={selected.map((element) => element.elementId).join('\0')}
        ref={setBar}
        data-selection-bar=""
        role="toolbar"
        aria-label={t('label')}
        // Над рамкой и ручками Moveable: у них z-index 3000.
        className="pointer-events-auto absolute z-[3001] flex items-center gap-0.5 rounded-xl bg-card p-1 shadow-lg ring-1 shadow-black/25 ring-border"
        style={{
          left: placement?.x ?? 0,
          top: placement?.y ?? 0,
          visibility: placement ? 'visible' : 'hidden',
        }}
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={FADE}
      >
        <span className="px-2 text-xs font-medium whitespace-nowrap text-foreground tabular-nums">
          {single ? t(`roles.${single.role}`) : t('count', { count: selected.length })}
        </span>
        {single?.kind === 'text' ? (
          <TextStyle
            element={single}
            designSystem={designSystem}
            side={side}
            onFontSize={(sizePt) => onFontSize(single.elementId, sizePt)}
            onColor={(role, hex) => onColor(single.elementId, role, hex)}
          />
        ) : null}
        {single
          ? null
          : ALIGNMENTS.map(({ id, icon }) => (
              <BarButton
                key={id}
                icon={icon}
                label={t(`align.${id}`)}
                side={side}
                onClick={() => onAlign(id)}
              />
            ))}
        <Separator
          orientation="vertical"
          className="mx-1 data-vertical:h-5 data-vertical:self-center"
        />
        <BarButton
          icon={Delete02Icon}
          label={t('remove')}
          keys={['Del']}
          side={side}
          tone="danger"
          onClick={onRemove}
        />
      </motion.div>
    </TooltipProvider>
  );
}
