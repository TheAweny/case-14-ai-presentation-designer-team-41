'use client';

import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react';
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
  ArrowLeft02Icon,
  ArrowRight02Icon,
  ChartBarLineIcon,
  Copy01Icon,
  Delete02Icon,
  DistributeHorizontalCenterIcon,
  DistributeVerticalCenterIcon,
  FitToScreenIcon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  ImageCropIcon,
  CropIcon,
  ImageUploadIcon,
  LayerBringForwardIcon,
  LayerBringToFrontIcon,
  LayerSendBackwardIcon,
  LayerSendToBackIcon,
  Layers01Icon,
  LockKeyholeIcon,
  LockKeyholeOpenIcon,
  MoreHorizontalIcon,
  PanelRightIcon,
  TableIcon,
} from '@hugeicons/core-free-icons';
import type { ColorRole, DesignSystem, ImageFit, SlideElement, SlideIr } from '@lct/contracts';
import type { ArrangeTarget } from '@lct/deck-ops';
import { EMU_PER_PT } from '@lct/slide-renderer';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  BarButton,
  BarItem,
  BarMenu,
  BarSeparator,
  BarSideContext,
  ShortcutKeys,
  useRovingToolbar,
} from '@/components/editor/bar-controls';
import { TextBarControls, type TextBarActions } from '@/components/editor/bar-text-controls';
import { keepFocusOnPress, stopCanvasMenu } from '@/components/editor/chrome-focus';
import type { CanvasCommand } from '@/components/editor/editor-keymap';
import { ColorField, NumberCombobox } from '@/components/editor/inspector/controls';
import type { DesignPanelProps } from '@/components/editor/inspector/design-panel';
import type { ShortcutId } from '@/components/editor/editor-shortcuts';
import {
  alignToSlide,
  defaultStrokeColor,
  lineEndEntries,
  strokeColorEntries,
} from '@/components/editor/inspector/selection-model';
import { textLook, type TextElement } from '@/components/editor/inspector/text-model';
import { barArea, barContext } from '@/components/editor/selection-bar-model';
import { distributeUnits, isWholeGroup, unitCount } from '@/components/editor/group-selection';
import {
  placeSelectionBar,
  rotatedBounds,
  SELECTION_BAR_CLEARANCE,
  unionBox,
  type Alignment,
  type DistributeAxis,
} from '@/components/editor/slide-geometry';
import { pickImageFiles, registerImage } from '@/lib/image-files';

/** Зазор между полосой и краем видимой области. От выделения — `SELECTION_BAR_CLEARANCE`. */
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

const LAYERS: readonly { id: ArrangeTarget; icon: IconSvgElement; shortcut: ShortcutId }[] = [
  { id: 'front', icon: LayerBringToFrontIcon, shortcut: 'bring-front' },
  { id: 'forward', icon: LayerBringForwardIcon, shortcut: 'bring-forward' },
  { id: 'backward', icon: LayerSendBackwardIcon, shortcut: 'send-backward' },
  { id: 'back', icon: LayerSendToBackIcon, shortcut: 'send-back' },
];

const FITS: readonly { id: ImageFit; icon: IconSvgElement }[] = [
  { id: 'contain', icon: FitToScreenIcon },
  { id: 'cover', icon: ImageCropIcon },
];

/** Частые толщины линии, в пунктах. Ввести можно любую. */
const STROKE_WIDTHS = [0.5, 1, 1.5, 2, 3, 4, 6, 8] as const;

type Placement = { x: number; y: number; below: boolean };

/** Рейка инструментов поверх холста: к какому краю прижата и где стоит, в пикселях слоя. */
function railIn(overlay: HTMLElement, origin: DOMRect) {
  const dock = overlay.closest<HTMLElement>('[data-dock-side]');
  const rail = dock?.querySelector<HTMLElement>('[data-tool-rail]');
  const side = dock?.dataset.dockSide;
  if (!rail || !side) return null;
  const rect = rail.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return {
    side,
    box: {
      x: rect.left - origin.left,
      y: rect.top - origin.top,
      width: rect.width,
      height: rect.height,
    },
  };
}

type Decor = Extract<SlideElement, { kind: 'decor' }>;

/**
 * Чем полоса правит слайд. Это те же правки, что у панели «Дизайн», — одни пути записи в
 * журнал на обе, — плюс команды холста (дублировать, слои, буфер) и переход в панель.
 */
export type SelectionBarActions = Pick<
  DesignPanelProps,
  | 'onCommit'
  | 'onAlign'
  | 'onProps'
  | 'onPropsEach'
  | 'onPreviewEnd'
  | 'onFontSizes'
  | 'onColorAll'
  | 'onReplaceImage'
  | 'onStartCrop'
> & {
  /** Та же точка входа, что у клавиатуры и контекстного меню холста. */
  readonly onCommand: (command: CanvasCommand) => void;
  /** Открыть свойства выделенного в правой панели. */
  readonly onOpenInspector: () => void;
  /** Есть ли что вставить: скопированное в этой вкладке. */
  readonly canPaste: boolean;
};

/**
 * Полоса свойств у выделения — контекстный тулбар, как у Figma и Google Slides: стоит над
 * выделением, а если сверху не хватает места — под ним, и не выходит за видимую область
 * холста. У текста — типографика, у фигуры — заливка и обводка, у картинки — замена и
 * вписывание, у нескольких объектов — выравнивание и распределение. Общее для всех —
 * дублировать, слои, замок, удалить и «ещё». Остальное — в правой панели.
 *
 * У каждого нового выделения полоса появляется заново, а пока рамку тащат, тянут или
 * вращают — её нет: под ней меняется сама рамка. Во время набора текста выделения нет, и
 * полосы тоже: там своя полоса формата фрагмента (`TextFormatBar`) из тех же контролов.
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
  actions,
  onEditTable,
}: {
  /** Экранный слой поверх видимой области холста: полоса лежит в его пикселях. */
  overlay: HTMLElement;
  /** Кадр открытого слайда: от его экранного прямоугольника считается выделение. */
  slideRoot: HTMLElement;
  slide: SlideIr;
  designSystem: DesignSystem;
  selectedIds: readonly string[];
  hidden: boolean;
  actions: SelectionBarActions;
  /** Открыть ячейки таблицы для набора — как двойной клик по ней. */
  onEditTable: (elementId: string) => void;
}) {
  const t = useTranslations('selectionBar');
  const reduceMotion = useReducedMotion() === true;
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [resized, setResized] = useState(0);
  const roving = useRovingToolbar();
  const rememberBar = useCallback(
    (node: HTMLDivElement | null) => {
      setBar(node);
      roving.ref(node);
    },
    [roving.ref],
  );
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
  // Повёрнутый объект занимает больше своей рамки: полоса обходит его углы.
  useLayoutEffect(() => {
    const bounds = unionBox(
      slide.elements
        .filter((element) => selectedIds.includes(element.elementId))
        .map((element) => rotatedBounds(element.box, element.rotation)),
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
      barArea(origin, railIn(overlay, origin)),
      GAP,
      // От рамки дальше, чем от краёв: зоны поворота за угловыми ручками остаются свободны.
      SELECTION_BAR_CLEARANCE,
    );
    setPlacement((previous) =>
      previous?.x === next.x && previous.y === next.y && previous.below === next.below
        ? previous
        : next,
    );
  }, [overlay, slideRoot, bar, slide, selectedIds, hidden, resized]);

  const context = barContext(selected);
  if (context === null || hidden) return null;
  const ids = selected.map((element) => element.elementId);
  const side = placement?.below ? 'bottom' : 'top';
  const only = selected.length === 1 ? selected[0] : undefined;

  let controls: ReactNode;
  if (only?.kind === 'text') {
    controls = <TextControls element={only} designSystem={designSystem} actions={actions} />;
  } else if (only?.kind === 'decor') {
    controls = <DecorControls element={only} designSystem={designSystem} actions={actions} />;
  } else if (only?.kind === 'image') {
    controls = <ImageControls element={only} actions={actions} />;
  } else if (only?.kind === 'table') {
    controls = (
      <BarButton
        icon={TableIcon}
        label={t('editTable')}
        onClick={() => onEditTable(only.elementId)}
      >
        {t('editTableShort')}
      </BarButton>
    );
  } else if (only?.kind === 'chart') {
    controls = (
      <BarButton icon={ChartBarLineIcon} label={t('editChart')} onClick={actions.onOpenInspector}>
        {t('editChartShort')}
      </BarButton>
    );
  } else {
    controls = <ArrangeControls slide={slide} selected={selected} actions={actions} />;
  }

  return (
    <BarSideContext.Provider value={side}>
      <TooltipProvider>
        <motion.div
          // Новое выделение — новая полоса: она проявляется у своего объекта, а не едет от старого.
          key={ids.join('\0')}
          ref={rememberBar}
          data-selection-bar=""
          data-editor-chrome=""
          role="toolbar"
          aria-label={t('label')}
          onMouseDown={keepFocusOnPress}
          onContextMenu={stopCanvasMenu}
          onFocus={roving.onFocus}
          onKeyDown={roving.onKeyDown}
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
          {controls}
          <BarSeparator />
          <CommonControls slide={slide} selected={selected} actions={actions} context={context} />
        </motion.div>
      </TooltipProvider>
    </BarSideContext.Provider>
  );
}

/**
 * Текстовый блок целиком: правки в журнал. B/I/U, «−»/«+» и выравнивание — те же команды,
 * что у Ctrl+B/I/U, Ctrl+Shift+</> и Ctrl+Shift+L/E/R/J; остальное — проводка панели «Дизайн».
 */
function TextControls({
  element,
  designSystem,
  actions,
}: {
  element: TextElement;
  designSystem: DesignSystem;
  actions: SelectionBarActions;
}) {
  const ids = [element.elementId];
  const text: TextBarActions = {
    look: textLook([element], designSystem),
    live: true,
    setFont: (fontFamily) => actions.onProps(ids, { fontFamily }),
    setSize: (sizePt) => actions.onFontSizes([{ elementId: element.elementId, sizePt }]),
    stepSize: (step) => actions.onCommand({ kind: 'text-size', step }),
    toggleFlag: (flag) => actions.onCommand({ kind: 'text-flag', flag }),
    setColor: (color, hex, mode) => actions.onColorAll(ids, color, hex, mode),
    setAlign: (align) => actions.onCommand({ kind: 'text-align', align }),
    setVerticalAlign: (verticalAlign) => actions.onProps(ids, { verticalAlign }),
    onPreviewEnd: actions.onPreviewEnd,
  };
  return <TextBarControls designSystem={designSystem} actions={text} />;
}

/** Фигура: заливка, обводка и её толщина; у линии — цвет, толщина и стрелки на концах. */
function DecorControls({
  element,
  designSystem,
  actions,
}: {
  element: Decor;
  designSystem: DesignSystem;
  actions: SelectionBarActions;
}) {
  const t = useTranslations('selectionBar');
  const panel = useTranslations('designPanel');
  const palette = useTranslations('selectionBar.palette');
  const side = useContext(BarSideContext);
  const decors = [element];
  const ids = [element.elementId];
  const line = element.shape === 'line';
  const roleLabel = (role: ColorRole) => palette(role);
  const stroke = element.stroke ?? null;
  const setStroke = (color: Parameters<typeof strokeColorEntries>[1], mode?: 'preview') =>
    actions.onPropsEach(strokeColorEntries(decors, color), mode);
  const arrow = (end: 'head' | 'tail') =>
    actions.onPropsEach(
      lineEndEntries(decors, end, stroke?.[end] !== 'arrow', defaultStrokeColor(designSystem)),
    );

  return (
    <>
      {line ? null : (
        <BarItem label={panel('fill')}>
          <ColorField
            variant="swatch"
            ariaLabel={panel('fill')}
            side={side}
            palette={designSystem.palette}
            value={element.fill ?? null}
            roleLabel={roleLabel}
            noneLabel={panel('none')}
            onChange={(value) => actions.onProps(ids, { fill: value })}
            onPreview={(hex) => actions.onProps(ids, { fill: hex }, 'preview')}
            onPreviewEnd={actions.onPreviewEnd}
          />
        </BarItem>
      )}
      <BarItem label={line ? panel('line') : panel('stroke')}>
        <ColorField
          variant="swatch"
          ariaLabel={line ? panel('line') : panel('stroke')}
          side={side}
          palette={designSystem.palette}
          value={stroke === null ? null : stroke.color}
          roleLabel={roleLabel}
          noneLabel={line ? undefined : panel('none')}
          renderSwatch={({ hex, none }) => (
            <span
              aria-hidden
              className="relative block size-4 rounded-full border-[3px] bg-transparent"
              style={{ borderColor: hex && !none ? `#${hex}` : 'var(--border)' }}
            />
          )}
          onChange={(value) => setStroke(value)}
          onPreview={(hex) => setStroke(hex, 'preview')}
          onPreviewEnd={actions.onPreviewEnd}
        />
      </BarItem>
      {stroke === null ? null : (
        // Толщина — только у того, что обведено: без обводки её нечему задать.
        <BarItem label={panel('strokeWidth')} className="w-16">
          <NumberCombobox
            ariaLabel={panel('strokeWidth')}
            presetsLabel={t('strokeWidths')}
            mixedLabel={panel('mixed')}
            value={stroke.widthEmu / EMU_PER_PT}
            presets={STROKE_WIDTHS.map((value) => ({ value }))}
            step={0.5}
            min={0.25}
            max={50}
            precision={2}
            onCommit={(value) => {
              if (value !== null) {
                actions.onProps(ids, { stroke: { widthEmu: Math.round(value * EMU_PER_PT) } });
              }
            }}
          />
        </BarItem>
      )}
      {line ? (
        <>
          <BarButton
            icon={ArrowLeft02Icon}
            label={panel('headArrow')}
            pressed={stroke?.head === 'arrow'}
            onClick={() => arrow('head')}
          />
          <BarButton
            icon={ArrowRight02Icon}
            label={panel('tailArrow')}
            pressed={stroke?.tail === 'arrow'}
            onClick={() => arrow('tail')}
          />
        </>
      ) : null}
    </>
  );
}

/** Картинка: другой файл в ту же рамку и вписывание — целиком или с обрезкой. */
function ImageControls({
  element,
  actions,
}: {
  element: Extract<SlideElement, { kind: 'image' }>;
  actions: SelectionBarActions;
}) {
  const t = useTranslations('selectionBar');
  const panel = useTranslations('designPanel');
  const replace = async () => {
    const [file] = await pickImageFiles();
    if (!file) return;
    const { mediaPart } = await registerImage(file);
    actions.onReplaceImage(element.elementId, mediaPart);
  };
  return (
    <>
      <BarButton
        icon={ImageUploadIcon}
        label={panel('replaceImage')}
        onClick={() => void replace()}
      >
        {t('replace')}
      </BarButton>
      {actions.onStartCrop ? (
        <BarButton
          icon={CropIcon}
          label={panel('cropImage')}
          pressed={element.crop !== undefined}
          onClick={() => actions.onStartCrop?.(element.elementId)}
        />
      ) : null}
      {FITS.map(({ id, icon }) => (
        <BarButton
          key={id}
          icon={icon}
          label={panel(`fits.${id}`)}
          pressed={element.fit === id}
          onClick={() => {
            if (element.fit !== id) actions.onProps([element.elementId], { fit: id });
          }}
        />
      ))}
    </>
  );
}

/**
 * Несколько объектов: выровнять между собой и распределить промежутки поровну. Группа — один
 * объект: в подписи, в выравнивании и в распределении она едет целиком.
 */
function ArrangeControls({
  slide,
  selected,
  actions,
}: {
  slide: SlideIr;
  selected: readonly SlideElement[];
  actions: SelectionBarActions;
}) {
  const t = useTranslations('selectionBar');
  const ids = selected.map((element) => element.elementId);
  const units = unitCount(slide.elements, ids);
  const distribute = (axis: DistributeAxis) => {
    const moves = distributeUnits(slide.elements, ids, axis);
    if (moves.length > 0) actions.onCommit(moves);
  };
  return (
    <>
      <span className="px-1.5 text-xs font-medium whitespace-nowrap text-foreground tabular-nums">
        {isWholeGroup(slide.elements, ids) ? t('group') : t('count', { count: units })}
      </span>
      {ALIGNMENTS.map(({ id, icon }) => (
        <BarButton
          key={id}
          icon={icon}
          label={t(`align.${id}`)}
          onClick={() => actions.onAlign(id)}
        />
      ))}
      <BarMenu
        icon={DistributeHorizontalCenterIcon}
        label={t('distribute')}
        disabled={units < 3}
        content={
          <>
            <DropdownMenuItem onSelect={() => distribute('horizontal')}>
              <HugeiconsIcon
                icon={DistributeHorizontalCenterIcon}
                strokeWidth={1.5}
                color="currentColor"
              />
              {t('distributeHorizontal')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => distribute('vertical')}>
              <HugeiconsIcon
                icon={DistributeVerticalCenterIcon}
                strokeWidth={1.5}
                color="currentColor"
              />
              {t('distributeVertical')}
            </DropdownMenuItem>
          </>
        }
      />
    </>
  );
}

/** Общее для любого выделения: дублировать, слои, замок, удалить и меню «ещё». */
function CommonControls({
  slide,
  selected,
  actions,
  context,
}: {
  slide: SlideIr;
  selected: readonly SlideElement[];
  actions: SelectionBarActions;
  context: NonNullable<ReturnType<typeof barContext>>;
}) {
  const t = useTranslations('selectionBar');
  const menu = useTranslations('canvasMenu');
  const panel = useTranslations('designPanel');
  const locked = selected.every((element) => element.locked === true);
  const flippable = selected.every((element) => element.kind === 'decor');
  const run = (command: CanvasCommand) => () => actions.onCommand(command);
  const shortcut = (id: ShortcutId) => (
    <DropdownMenuShortcut>
      <ShortcutKeys shortcut={id} />
    </DropdownMenuShortcut>
  );

  return (
    <>
      <BarButton
        icon={Copy01Icon}
        label={menu('duplicate')}
        shortcut="duplicate"
        onClick={run({ kind: 'duplicate' })}
      />
      <BarMenu
        icon={Layers01Icon}
        label={t('layers')}
        content={LAYERS.map(({ id, icon, shortcut: keys }) => (
          <DropdownMenuItem key={id} onSelect={run({ kind: 'arrange', to: id })}>
            <HugeiconsIcon icon={icon} strokeWidth={1.5} color="currentColor" />
            {menu(id)}
            {shortcut(keys)}
          </DropdownMenuItem>
        ))}
      />
      <BarButton
        icon={locked ? LockKeyholeIcon : LockKeyholeOpenIcon}
        label={locked ? panel('unlock') : panel('lock')}
        shortcut="lock"
        pressed={locked}
        // Как Alt+Shift+L: заблокированное не выделяется, и выделение снимается.
        onClick={run({ kind: 'lock' })}
      />
      <BarButton
        icon={Delete02Icon}
        label={menu('remove')}
        shortcut="remove"
        tone="danger"
        onClick={run({ kind: 'remove' })}
      />
      <BarMenu
        icon={MoreHorizontalIcon}
        label={t('more')}
        contentClassName="min-w-56"
        content={
          <>
            <DropdownMenuItem onSelect={run({ kind: 'copy' })}>
              {menu('copy')}
              {shortcut('copy')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={run({ kind: 'cut' })}>
              {menu('cut')}
              {shortcut('cut')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!actions.canPaste} onSelect={run({ kind: 'paste' })}>
              {menu('paste')}
              {shortcut('paste')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t('alignToSlide')}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent data-editor-chrome="" className="z-[4000]">
                {ALIGNMENTS.map(({ id, icon }) => (
                  <DropdownMenuItem
                    key={id}
                    onSelect={() => {
                      const moves = alignToSlide(selected, id, slide);
                      if (moves.length > 0) actions.onCommit(moves);
                    }}
                  >
                    <HugeiconsIcon icon={icon} strokeWidth={1.5} color="currentColor" />
                    {t(`align.${id}`)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {flippable ? (
              <>
                <DropdownMenuItem onSelect={run({ kind: 'flip', axis: 'horizontal' })}>
                  <HugeiconsIcon icon={FlipHorizontalIcon} strokeWidth={1.5} color="currentColor" />
                  {panel('flipH')}
                  {shortcut('flip-horizontal')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run({ kind: 'flip', axis: 'vertical' })}>
                  <HugeiconsIcon icon={FlipVerticalIcon} strokeWidth={1.5} color="currentColor" />
                  {panel('flipV')}
                  {shortcut('flip-vertical')}
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={actions.onOpenInspector}>
              <HugeiconsIcon icon={PanelRightIcon} strokeWidth={1.5} color="currentColor" />
              {context === 'chart' || context === 'table' ? t('openData') : t('openInspector')}
            </DropdownMenuItem>
          </>
        }
      />
    </>
  );
}
