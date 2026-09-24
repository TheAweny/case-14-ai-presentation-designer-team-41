'use client';

import { useState, type MouseEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  AlignBottomIcon,
  AlignHorizontalCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  AlignTopIcon,
  AlignVerticalCenterIcon,
  ArrowRight01Icon,
  CircleIcon,
  DashedLine01Icon,
  DashedLine02Icon,
  DiamondIcon,
  FitToScreenIcon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  ImageCropIcon,
  ImageUploadIcon,
  CropIcon,
  LayerBringForwardIcon,
  LayerBringToFrontIcon,
  LayerSendBackwardIcon,
  LayerSendToBackIcon,
  LetterSpacingIcon,
  Link01Icon,
  LockIcon,
  LockOpenIcon,
  MinusSignIcon,
  ParagraphSpacingIcon,
  Rotate01Icon,
  RotateClockwiseIcon,
  SquareIcon,
  SquareRoundCornerIcon,
  TextAlignCenterIcon,
  TextAlignJustifyLeftIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
  TextFontIcon,
  TextUnderlineIcon,
  TransparencyIcon,
  TriangleIcon,
  UndoIcon,
  Unlink01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type {
  ColorRole,
  ColorValue,
  DecorShape,
  DesignSystem,
  ElementStroke,
  ImageFit,
  ParagraphAlign,
  SlideElement,
  SlideIr,
  StrokeDash,
  TypeRole,
  VerticalAlign,
} from '@lct/contracts';
import {
  FONT_SIZE_PT,
  LETTER_SPACING_PT,
  LINE_SPACING,
  type ArrangeTarget,
  type ElementProps,
} from '@lct/deck-ops';
import { EMU_PER_PT } from '@lct/slide-renderer';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import type { Alignment } from '@/components/editor/slide-geometry';
import type {
  EditMode,
  ElementMove,
  FontSizeEntry,
  PropsEntry,
} from '@/components/editor/use-deck-history';
import {
  ColorField,
  FieldRow,
  FontPicker,
  FontStyleField,
  IconButton,
  NumberCombobox,
  NumberField,
  Section,
  Segmented,
  type NumberFieldProps,
  type NumberPreset,
} from '@/components/editor/inspector/controls';
import { colorHex } from '@/components/editor/inspector/fields/color';
import { cn } from '@/lib/utils';
import { pickImageFiles, registerImage } from '@/lib/image-files';
import { ChartSection } from '@/components/editor/inspector/chart-section';
import { TableSection, type TableAction } from '@/components/editor/inspector/table-section';
import type { TableOps } from '@/components/editor/use-table-ops';
import type { ChartData } from '@/components/editor/inspector/chart-data';
import {
  leadSizePt,
  rangeLook,
  templateFonts,
  textLook,
  typeSteps,
  type TextElement,
  type TextLook,
} from '@/components/editor/inspector/text-model';
import {
  rangeMarks,
  setParagraphAlign,
  setParagraphLineSpacing,
  setRangeColor,
  setRangeFont,
  setRangeLetterSpacing,
  setRangeSize,
  setRunFlag,
  type ActiveTextEditor,
} from '@/components/editor/active-text-editor';
import {
  alignToSlide,
  commonValue,
  cornerRadiusProps,
  cornerRadiusPt,
  emuToPt,
  maxCornerRadiusPt,
  setBoxField,
  setBoxFieldEach,
  setBoxSizeLocked,
  type BoxField,
} from '@/components/editor/inspector/selection-model';

/**
 * Что панель «Дизайн» умеет сделать со слайдом. Правки уходят в журнал колоды одной записью
 * на жест: число — по Enter, уходу из поля или отпусканию мыши, цвет — по выбору или отпусканию
 * мыши в пикере. `mode: 'preview'` — живой вид на время жеста, без записи в журнал.
 */
export type DesignPanelProps = {
  /** Открытый слайд без живого вида жеста: от него панель считает значения. */
  slide: SlideIr | undefined;
  designSystem: DesignSystem;
  selectedIds: readonly string[];
  /** Новые рамки объектов: один список на жест, не шаг на каждый пиксель. */
  onCommit: (moves: readonly ElementMove[], mode?: EditMode) => void;
  onRemove: () => void;
  /** Выровнять выделенные объекты между собой. */
  onAlign: (alignment: Alignment) => void;
  /** Кегль текстам, каждому свой, — одной записью журнала. */
  onFontSizes: (entries: readonly FontSizeEntry[], mode?: EditMode) => void;
  /** Цвет всем выделенным текстам: роль палитры или свой HEX; `hex` — чем красить runs. */
  onColorAll: (
    elementIds: readonly string[],
    color: ColorValue,
    hex: string,
    mode?: EditMode,
  ) => void;
  /** Свойства вида: заливка, обводка, форма, поворот, шрифт и остальное из `ElementProps`. */
  onProps: (elementIds: readonly string[], props: ElementProps, mode?: EditMode) => void;
  /** Каждому объекту свои свойства — одной записью журнала. */
  onPropsEach: (entries: readonly PropsEntry[], mode?: EditMode) => void;
  /** Жест кончился без записи (Esc): живой вид убрать. */
  onPreviewEnd: () => void;
  /** Открытый на холсте набор: типографика правит его выделенный фрагмент. */
  textEditor: ActiveTextEditor | null;
  /** Порядок слоёв выделенного. */
  onArrange: (to: ArrangeTarget) => void;
  /** Новый файл в рамке картинки. */
  onReplaceImage: (elementId: string, mediaPart: string) => void;
  /** Открыть кадрирование картинки на холсте, как двойной клик. */
  onStartCrop?: (elementId: string) => void;
  /** Убрать обрезку: картинка снова целиком, по «Вписать/Заполнить». */
  onResetCrop?: (elementId: string) => void;
  /** Фон слайда: роль палитры, свой HEX или null — как задал шаблон. */
  onSlideBackground: (background: ColorValue | null, mode?: EditMode) => void;
  /** Строки и столбцы таблицы. */
  onTable: (elementId: string, action: TableAction) => void;
  /** Ячейки, размеры и вид таблицы; без них панель показывает только размер сеткой. */
  tableOps?: TableOps;
  /** Данные графика целиком: одна запись журнала на правку. */
  onChartData: (elementId: string, data: ChartData) => void;
  onChartAxes: (elementId: string, titles: { xTitle?: string; yTitle?: string }) => void;
};

export type { TableAction } from '@/components/editor/inspector/table-section';

const ALIGN_X = [
  { id: 'left', icon: AlignLeftIcon },
  { id: 'center', icon: AlignHorizontalCenterIcon },
  { id: 'right', icon: AlignRightIcon },
] as const satisfies readonly { id: Alignment; icon: unknown }[];

const ALIGN_Y = [
  { id: 'top', icon: AlignTopIcon },
  { id: 'middle', icon: AlignVerticalCenterIcon },
  { id: 'bottom', icon: AlignBottomIcon },
] as const satisfies readonly { id: Alignment; icon: unknown }[];

const ARRANGE = [
  { id: 'back', icon: LayerSendToBackIcon },
  { id: 'backward', icon: LayerSendBackwardIcon },
  { id: 'forward', icon: LayerBringForwardIcon },
  { id: 'front', icon: LayerBringToFrontIcon },
] as const satisfies readonly { id: ArrangeTarget; icon: unknown }[];

/** Формы, между которыми можно переключить фигуру. Линия — отдельный инструмент. */
const SHAPES = [
  { value: 'rect', icon: SquareIcon },
  { value: 'round-rect', icon: SquareRoundCornerIcon },
  { value: 'ellipse', icon: CircleIcon },
  { value: 'triangle', icon: TriangleIcon },
  { value: 'diamond', icon: DiamondIcon },
] as const satisfies readonly { value: DecorShape; icon: unknown }[];

const DASHES = [
  { value: 'solid', icon: MinusSignIcon },
  { value: 'dash', icon: DashedLine01Icon },
  { value: 'dot', icon: DashedLine02Icon },
] as const satisfies readonly { value: StrokeDash; icon: unknown }[];

const FITS = [
  { value: 'contain', icon: FitToScreenIcon },
  { value: 'cover', icon: ImageCropIcon },
] as const satisfies readonly { value: ImageFit; icon: unknown }[];

const TEXT_ALIGNS = [
  { value: 'left', icon: TextAlignLeftIcon },
  { value: 'center', icon: TextAlignCenterIcon },
  { value: 'right', icon: TextAlignRightIcon },
  { value: 'justify', icon: TextAlignJustifyLeftIcon },
] as const satisfies readonly { value: ParagraphAlign; icon: unknown }[];

const VERTICAL_ALIGNS = [
  { value: 'top', icon: AlignTopIcon },
  { value: 'middle', icon: AlignVerticalCenterIcon },
  { value: 'bottom', icon: AlignBottomIcon },
] as const satisfies readonly { value: VerticalAlign; icon: unknown }[];

/** Частые межстрочные интервалы, в процентах одинарного. */
const LINE_HEIGHTS = [100, 120, 150, 200] as const;

/** Обводка, которую получает фигура без неё: тонкая сплошная линия. */
function freshStroke(color: ColorValue): ElementStroke {
  return { color, widthEmu: EMU_PER_PT, dash: 'solid', head: 'none', tail: 'none' };
}

type Decor = Extract<SlideElement, { kind: 'decor' }>;
type ImageElement = Extract<SlideElement, { kind: 'image' }>;

function isDecor(element: SlideElement): element is Decor {
  return element.kind === 'decor';
}

function isText(element: SlideElement): element is TextElement {
  return element.kind === 'text';
}

function isImage(element: SlideElement): element is ImageElement {
  return element.kind === 'image';
}

/** Одно значение на всех или null — «разные». Числа сравниваются с допуском на округление. */
function common(values: readonly number[]): number | null {
  const [first, ...rest] = values;
  if (first === undefined) return null;
  return rest.every((value) => Math.abs(value - first) < 1e-6) ? first : null;
}

function commonString<T extends string>(values: readonly (T | null)[]): T | null {
  const [first, ...rest] = values;
  if (first === undefined) return null;
  return rest.every((value) => value === first) ? first : null;
}

/**
 * Проводка числового поля к правке, которая умеет и запись, и живой вид: `set` — одно
 * значение всем, `each` — каждому от своего (`+10` при «разных»).
 */
function edits(
  set: (value: number, mode: EditMode) => void,
  each: ((apply: (old: number) => number, mode: EditMode) => void) | undefined,
  onPreviewEnd: () => void,
): Pick<
  NumberFieldProps,
  'onCommit' | 'onPreview' | 'onCommitEach' | 'onPreviewEach' | 'onPreviewEnd'
> {
  return {
    onCommit: (value) => set(value, 'commit'),
    onPreview: (value) => set(value, 'preview'),
    onCommitEach: each ? (apply) => each(apply, 'commit') : undefined,
    onPreviewEach: each ? (apply) => each(apply, 'preview') : undefined,
    onPreviewEnd,
  };
}

/** Группа кнопок-иконок на серой плашке. */
function ButtonGroup({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-7 min-w-0 items-center justify-between rounded-md bg-muted/60">
      {children}
    </div>
  );
}

/** Свойства выделения по секциям, в порядке панели Design у Figma. */
export function DesignPanel(props: DesignPanelProps) {
  const names = useTranslations('selectionBar');
  const { slide, selectedIds } = props;
  const selected = slide
    ? slide.elements.filter((element) => selectedIds.includes(element.elementId))
    : [];

  if (!slide) return null;
  if (selected.length === 0) return <SlidePanel {...props} slide={slide} />;

  const single = selected.length === 1 ? selected[0] : undefined;
  const decors = selected.every(isDecor) ? (selected as Decor[]) : [];
  const texts = selected.every(isText) ? (selected as TextElement[]) : [];
  const images = selected.every(isImage) ? (selected as ImageElement[]) : [];
  const table = single?.kind === 'table' ? single : undefined;
  const chart = single?.kind === 'chart' ? single : undefined;

  return (
    <div className="flex flex-col">
      <div className="flex min-h-10 items-center gap-2 border-b border-border pr-2 pl-3">
        <h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
          {single ? names(`roles.${single.role}`) : names('count', { count: selected.length })}
        </h2>
        <LockToggle {...props} selected={selected} />
      </div>
      <PositionSection {...props} slide={slide} selected={selected} decors={decors} />
      <LayoutSection {...props} selected={selected} />
      <AppearanceSection {...props} selected={selected} decors={decors} />
      {texts.length > 0 ? <TextSections {...props} texts={texts} /> : null}
      {images.length > 0 ? <ImageSection {...props} images={images} /> : null}
      {table ? (
        <TableSection
          table={table}
          slide={slide}
          designSystem={props.designSystem}
          ops={props.tableOps}
          onTable={props.onTable}
        />
      ) : null}
      {chart ? <ChartSection {...props} chart={chart} /> : null}
      {decors.length > 0 ? <DecorSections {...props} decors={decors} /> : null}
    </div>
  );
}

/** Замок: заблокированное не выделяется на холсте и не двигается, пока его не откроют. */
function LockToggle({
  selected,
  onProps,
}: DesignPanelProps & { selected: readonly SlideElement[] }) {
  const t = useTranslations('designPanel');
  const locked = selected.every((element) => element.locked === true);
  return (
    <IconButton
      icon={locked ? LockIcon : LockOpenIcon}
      label={locked ? t('unlock') : t('lock')}
      pressed={locked}
      onClick={() =>
        onProps(
          selected.map((element) => element.elementId),
          { locked: !locked },
        )
      }
    />
  );
}

/**
 * Ничего не выделено — панель показывает сам слайд, как Figma показывает фрейм: его заливку.
 * Подсказка остаётся: без неё пустая панель выглядит сломанной.
 */
function SlidePanel({
  slide,
  designSystem,
  onSlideBackground,
  onPreviewEnd,
}: DesignPanelProps & { slide: SlideIr }) {
  const t = useTranslations('designPanel');
  const palette = useTranslations('selectionBar.palette');
  const own = slide.background ?? null;
  // Без своего фона слайд рисуется ролью «фон»: её поле и показывает.
  const shown =
    own ??
    (designSystem.palette.some((entry) => entry.role === 'background') ? 'background' : null);
  return (
    <div className="flex flex-col">
      <div className="flex min-h-10 items-center border-b border-border px-3">
        <h2 className="truncate text-xs font-semibold text-foreground">{t('slide')}</h2>
      </div>
      <Section
        title={t('fill')}
        actions={
          own === null ? null : (
            <IconButton
              icon={UndoIcon}
              label={t('templateBackground')}
              onClick={() => onSlideBackground(null)}
            />
          )
        }
      >
        <ColorField
          ariaLabel={t('background')}
          palette={designSystem.palette}
          value={shown}
          roleLabel={(role) => palette(role)}
          onChange={(value) => onSlideBackground(value)}
          onPreview={(hex) => onSlideBackground(hex, 'preview')}
          onPreviewEnd={onPreviewEnd}
        />
      </Section>
      <p className="px-3 py-3 text-xs text-balance text-muted-foreground">{t('emptyHint')}</p>
    </div>
  );
}

/** Положение: выравнивание, X/Y, поворот, у фигур — отражение. */
function PositionSection({
  slide,
  selected,
  decors,
  onCommit,
  onAlign,
  onProps,
  onPropsEach,
  onPreviewEnd,
}: DesignPanelProps & {
  slide: SlideIr;
  selected: readonly SlideElement[];
  decors: readonly Decor[];
}) {
  const t = useTranslations('designPanel');
  const aligns = useTranslations('selectionBar.align');
  const mixed = t('mixed');
  const ids = selected.map((element) => element.elementId);

  const align = (alignment: Alignment) => {
    if (selected.length > 1) onAlign(alignment);
    else onCommit(alignToSlide(selected, alignment, slide));
  };
  const box = (name: BoxField) =>
    edits(
      (value, mode) => {
        const moves = setBoxField(selected, name, value);
        if (moves.length > 0) onCommit(moves, mode);
      },
      (apply, mode) => {
        const moves = setBoxFieldEach(selected, name, apply);
        if (moves.length > 0) onCommit(moves, mode);
      },
      onPreviewEnd,
    );
  const rotation = common(selected.map((element) => element.rotation ?? 0));
  const rotateEach = (apply: (old: number) => number, mode: EditMode = 'commit') =>
    onPropsEach(
      selected.map((element) => ({
        elementIds: [element.elementId],
        props: { rotation: apply(element.rotation ?? 0) },
      })),
      mode,
    );
  const flip = (axis: 'flipH' | 'flipV') =>
    onPropsEach(
      decors.map((element) => ({
        elementIds: [element.elementId],
        props:
          axis === 'flipH' ? { flipH: element.flipH !== true } : { flipV: element.flipV !== true },
      })),
    );
  const alignButton = ({ id, icon }: { id: Alignment; icon: typeof AlignLeftIcon }) => (
    <IconButton key={id} icon={icon} label={aligns(id)} onClick={() => align(id)} />
  );

  return (
    <Section title={t('position')}>
      <FieldRow>
        <ButtonGroup>{ALIGN_X.map(alignButton)}</ButtonGroup>
        <ButtonGroup>{ALIGN_Y.map(alignButton)}</ButtonGroup>
      </FieldRow>
      <FieldRow>
        <NumberField
          label="X"
          ariaLabel={t('x')}
          mixedLabel={mixed}
          value={common(selected.map((element) => emuToPt(element.box.x)))}
          {...box('x')}
        />
        <NumberField
          label="Y"
          ariaLabel={t('y')}
          mixedLabel={mixed}
          value={common(selected.map((element) => emuToPt(element.box.y)))}
          {...box('y')}
        />
      </FieldRow>
      <FieldRow>
        <NumberField
          icon={Rotate01Icon}
          ariaLabel={t('rotation')}
          mixedLabel={mixed}
          value={rotation}
          suffix="°"
          {...edits(
            (value, mode) => onProps(ids, { rotation: value }, mode),
            rotateEach,
            onPreviewEnd,
          )}
        />
        <div className="flex items-center gap-0.5">
          <IconButton
            icon={RotateClockwiseIcon}
            label={t('rotate90')}
            onClick={() => rotateEach((old) => old + 90)}
          />
          {decors.length > 0 ? (
            <>
              <IconButton
                icon={FlipHorizontalIcon}
                label={t('flipH')}
                pressed={decors.every((element) => element.flipH === true)}
                onClick={() => flip('flipH')}
              />
              <IconButton
                icon={FlipVerticalIcon}
                label={t('flipV')}
                pressed={decors.every((element) => element.flipV === true)}
                onClick={() => flip('flipV')}
              />
            </>
          ) : null}
        </div>
      </FieldRow>
    </Section>
  );
}

/** Макет: ширина и высота, замок пропорций. */
function LayoutSection({
  selected,
  onCommit,
  onPreviewEnd,
}: DesignPanelProps & { selected: readonly SlideElement[] }) {
  const t = useTranslations('designPanel');
  const [constrained, setConstrained] = useState(false);
  const mixed = t('mixed');

  const size = (name: 'cx' | 'cy') =>
    edits(
      (value, mode) => {
        const moves = constrained
          ? setBoxSizeLocked(selected, name, value)
          : setBoxField(selected, name, value);
        if (moves.length > 0) onCommit(moves, mode);
      },
      (apply, mode) => {
        const moves = constrained
          ? selected.flatMap((element) =>
              setBoxSizeLocked([element], name, apply(emuToPt(element.box[name]))),
            )
          : setBoxFieldEach(selected, name, apply);
        if (moves.length > 0) onCommit(moves, mode);
      },
      onPreviewEnd,
    );

  return (
    <Section title={t('layout')}>
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
        <NumberField
          label="W"
          ariaLabel={t('width')}
          mixedLabel={mixed}
          value={common(selected.map((element) => emuToPt(element.box.cx)))}
          min={1}
          {...size('cx')}
        />
        <NumberField
          label="H"
          ariaLabel={t('height')}
          mixedLabel={mixed}
          value={common(selected.map((element) => emuToPt(element.box.cy)))}
          min={1}
          {...size('cy')}
        />
        <IconButton
          icon={constrained ? Link01Icon : Unlink01Icon}
          label={t('constrainProportions')}
          pressed={constrained}
          onClick={() => setConstrained(!constrained)}
        />
      </div>
    </Section>
  );
}

/**
 * Оформление: порядок слоёв, у фигур — форма, непрозрачность, у прямоугольников — радиус в
 * пунктах. В слайде радиус — доля короткой стороны, поэтому у фигур разного размера один
 * радиус в пунктах — это разные доли.
 */
function AppearanceSection({
  selected,
  decors,
  onArrange,
  onProps,
  onPropsEach,
  onPreviewEnd,
}: DesignPanelProps & { selected: readonly SlideElement[]; decors: readonly Decor[] }) {
  const t = useTranslations('designPanel');
  const mixed = t('mixed');
  const ids = selected.map((element) => element.elementId);
  const opacity = common(selected.map((element) => element.opacity ?? 1));
  const shapes = decors.every((element) => element.shape !== 'line') ? decors : [];
  const shape = commonString(shapes.map((element) => element.shape ?? null));
  const rounded = shapes.filter((element) => cornerRadiusPt(element) !== null);
  const radii = rounded.length === shapes.length ? rounded : [];
  const radius = common(radii.map((element) => cornerRadiusPt(element) ?? 0));
  const single = radii.length === 1 ? radii[0] : undefined;

  const radiusEach = (apply: (old: number) => number, mode: EditMode) =>
    onPropsEach(
      radii.map((element) => ({
        elementIds: [element.elementId],
        props: cornerRadiusProps(element, apply(cornerRadiusPt(element) ?? 0)),
      })),
      mode,
    );

  return (
    <Section
      title={t('appearance')}
      actions={ARRANGE.map(({ id, icon }) => (
        <IconButton key={id} icon={icon} label={t(`arrange.${id}`)} onClick={() => onArrange(id)} />
      ))}
    >
      {shapes.length > 0 ? (
        <Segmented
          ariaLabel={t('shape')}
          value={shape}
          options={SHAPES.map((option) => ({ ...option, label: t(`shapes.${option.value}`) }))}
          onChange={(value) => onProps(ids, { shape: value })}
        />
      ) : null}
      <FieldRow>
        <NumberField
          icon={TransparencyIcon}
          ariaLabel={t('opacity')}
          mixedLabel={mixed}
          value={opacity === null ? null : Math.round(opacity * 100)}
          min={0}
          max={100}
          precision={0}
          suffix="%"
          {...edits(
            (value, mode) => onProps(ids, { opacity: value / 100 }, mode),
            (apply, mode) =>
              onPropsEach(
                selected.map((element) => ({
                  elementIds: [element.elementId],
                  props: { opacity: apply(Math.round((element.opacity ?? 1) * 100)) / 100 },
                })),
                mode,
              ),
            onPreviewEnd,
          )}
        />
        {radii.length > 0 ? (
          <NumberField
            icon={SquareRoundCornerIcon}
            ariaLabel={t('radius')}
            mixedLabel={mixed}
            value={radius}
            min={0}
            max={single ? maxCornerRadiusPt(single) : undefined}
            {...edits((value, mode) => radiusEach(() => value, mode), radiusEach, onPreviewEnd)}
          />
        ) : null}
      </FieldRow>
    </Section>
  );
}

/** Что умеют секции текста: одинаково для всего блока и для фрагмента в открытом наборе. */
interface TextActions {
  readonly look: TextLook;
  /** Живой вид при перетаскивании за подпись: только для целого блока, набор правится сразу. */
  readonly live: boolean;
  setSize(sizePt: number, mode: EditMode): void;
  setSizeEach?(apply: (old: number) => number, mode: EditMode): void;
  setFont(family: string | null): void;
  setStyle(flags: { bold: boolean; italic: boolean }): void;
  setUnderline(on: boolean): void;
  setLineSpacing(multiple: number | null, mode: EditMode): void;
  setLineSpacingEach?(apply: (old: number) => number, mode: EditMode): void;
  setLetterSpacing(pt: number, mode: EditMode): void;
  setLetterSpacingEach?(apply: (old: number) => number, mode: EditMode): void;
  setAlign(align: ParagraphAlign): void;
  setVerticalAlign(align: VerticalAlign): void;
  setColor(color: ColorValue, hex: string, mode: EditMode): void;
}

/**
 * Типографика и заливка текста. Выделен блок — правки на весь блок. Открыт набор — на
 * выделенные слова и абзацы, как в Figma; в журнал они попадут одним `set-text`, когда набор
 * закроется.
 */
function TextSections(props: DesignPanelProps & { texts: readonly TextElement[] }) {
  const { texts, textEditor } = props;
  const only = texts.length === 1 ? texts[0] : undefined;
  if (textEditor && only && only.elementId === textEditor.elementId) {
    return <RangeText {...props} editor={textEditor.editor} element={only} />;
  }
  return <WholeText {...props} />;
}

/** Межбуквенный интервал 0 — это «как у роли»: так он и хранится. */
function letterSpacingValue(pt: number): number | null {
  return pt === 0 ? null : pt;
}

function WholeText({
  designSystem,
  texts,
  onFontSizes,
  onColorAll,
  onProps,
  onPropsEach,
  onPreviewEnd,
}: DesignPanelProps & { texts: readonly TextElement[] }) {
  const ids = texts.map((element) => element.elementId);
  const look = textLook(texts, designSystem);
  const lookOf = (element: TextElement) => textLook([element], designSystem);
  const each = (
    read: (element: TextElement) => number,
    write: (value: number) => ElementProps,
    apply: (old: number) => number,
    mode: EditMode,
  ) =>
    onPropsEach(
      texts.map((element) => ({
        elementIds: [element.elementId],
        props: write(apply(read(element))),
      })),
      mode,
    );
  return (
    <TextControls
      designSystem={designSystem}
      onPreviewEnd={onPreviewEnd}
      actions={{
        look,
        live: true,
        setSize: (sizePt, mode) =>
          onFontSizes(
            ids.map((elementId) => ({ elementId, sizePt })),
            mode,
          ),
        setSizeEach: (apply, mode) =>
          onFontSizes(
            texts.flatMap((element) => {
              const old = leadSizePt(element, designSystem);
              return old === null ? [] : [{ elementId: element.elementId, sizePt: apply(old) }];
            }),
            mode,
          ),
        setFont: (fontFamily) => onProps(ids, { fontFamily }),
        setStyle: ({ bold, italic }) => onProps(ids, { bold, italic }),
        setUnderline: (on) => onProps(ids, { underline: on }),
        setLineSpacing: (lineSpacing, mode) => onProps(ids, { lineSpacing }, mode),
        setLineSpacingEach: (apply, mode) =>
          each(
            (element) => {
              const own = lookOf(element);
              return Math.round((own.lineSpacing ?? own.autoLineSpacing ?? 1) * 100);
            },
            (percent) => ({ lineSpacing: percent / 100 }),
            apply,
            mode,
          ),
        setLetterSpacing: (pt, mode) =>
          onProps(ids, { letterSpacingPt: letterSpacingValue(pt) }, mode),
        setLetterSpacingEach: (apply, mode) =>
          each(
            (element) => lookOf(element).letterSpacingPt ?? 0,
            (pt) => ({ letterSpacingPt: letterSpacingValue(pt) }),
            apply,
            mode,
          ),
        setAlign: (align) => onProps(ids, { align }),
        setVerticalAlign: (verticalAlign) => onProps(ids, { verticalAlign }),
        setColor: (color, hex, mode) => onColorAll(ids, color, hex, mode),
      }}
    />
  );
}

/** Кнопки панели не забирают фокус у набора: иначе он закрылся бы от первого клика. */
function keepEditorFocus(event: MouseEvent) {
  const target = event.target;
  if (target instanceof HTMLInputElement) return;
  event.preventDefault();
}

function RangeText({
  designSystem,
  editor,
  element,
  onProps,
  onPreviewEnd,
}: DesignPanelProps & { editor: Editor; element: TextElement }) {
  const marks = useEditorState({ editor, selector: ({ editor: current }) => rangeMarks(current) });
  const look = rangeLook(marks, element, designSystem);
  return (
    <div data-text-panel="" onMouseDown={keepEditorFocus}>
      <TextControls
        designSystem={designSystem}
        onPreviewEnd={onPreviewEnd}
        range
        actions={{
          look,
          live: false,
          setSize: (sizePt) => setRangeSize(editor, sizePt),
          setFont: (family) => setRangeFont(editor, family),
          setStyle: ({ bold, italic }) => {
            setRunFlag(editor, 'bold', bold);
            setRunFlag(editor, 'italic', italic);
          },
          setUnderline: (on) => setRunFlag(editor, 'underline', on),
          setLineSpacing: (multiple) => setParagraphLineSpacing(editor, multiple),
          setLetterSpacing: (pt) => setRangeLetterSpacing(editor, letterSpacingValue(pt)),
          setAlign: (align) => setParagraphAlign(editor, align),
          // Вертикальная привязка — свойство рамки, а не слов: её набор не трогает.
          setVerticalAlign: (verticalAlign) => onProps([element.elementId], { verticalAlign }),
          // Цвет в наборе меняется сразу и попадёт в журнал вместе с текстом.
          setColor: (_color, hex) => setRangeColor(editor, hex),
        }}
      />
    </div>
  );
}

function TextControls({
  designSystem,
  actions,
  range,
  onPreviewEnd,
}: {
  designSystem: DesignSystem;
  actions: TextActions;
  range?: boolean;
  onPreviewEnd: () => void;
}) {
  const t = useTranslations('designPanel');
  const scale = useTranslations('selectionBar.type');
  const palette = useTranslations('selectionBar.palette');
  const { look, live } = actions;
  const mixed = t('mixed');
  // Во время набора живой вид не нужен: фрагмент правится сразу.
  const noPreview = () => undefined;
  const wire = (
    set: (value: number, mode: EditMode) => void,
    each?: (apply: (old: number) => number, mode: EditMode) => void,
  ) => {
    const wired = edits(set, each, onPreviewEnd);
    return live ? wired : { ...wired, onPreview: noPreview, onPreviewEach: undefined };
  };

  const sizePresets: NumberPreset[] = typeSteps(designSystem).map((step) => ({
    value: step.sizePt,
    hint: scale(step.role as TypeRole),
  }));
  const auto = look.autoLineSpacing === null ? null : Math.round(look.autoLineSpacing * 100);
  const lineHeightPresets: NumberPreset[] = [
    { value: null, label: t('auto'), hint: auto === null ? undefined : `${auto} %` },
    ...LINE_HEIGHTS.map((value) => ({ value })),
  ];
  const lineHeight =
    look.lineSpacing === undefined
      ? undefined
      : look.lineSpacing === null
        ? null
        : Math.round(look.lineSpacing * 100);

  return (
    <>
      <Section
        title={t('typography')}
        actions={
          <IconButton
            icon={TextUnderlineIcon}
            label={t('underline')}
            pressed={look.underline}
            onClick={() => actions.setUnderline(!look.underline)}
          />
        }
      >
        {range ? (
          <p className="-mt-1 text-xs text-balance text-muted-foreground">
            {t('textSelectionHint')}
          </p>
        ) : null}
        <FontPicker
          ariaLabel={t('font')}
          value={look.font}
          templateFonts={templateFonts(designSystem)}
          placeholder={mixed}
          resetLabel={t('templateFont')}
          onChange={actions.setFont}
        />
        <FieldRow>
          <FontStyleField
            bold={look.bold}
            italic={look.italic}
            fontFamily={look.font ?? undefined}
            mixedLabel={mixed}
            onChange={actions.setStyle}
          />
          <NumberCombobox
            icon={TextFontIcon}
            ariaLabel={t('fontSize')}
            presetsLabel={t('fontSizePresets')}
            mixedLabel={mixed}
            value={look.sizePt ?? undefined}
            presets={sizePresets}
            min={FONT_SIZE_PT.min}
            max={FONT_SIZE_PT.max}
            {...wire(actions.setSize, actions.setSizeEach)}
            onCommit={(value) => {
              if (value !== null) actions.setSize(value, 'commit');
            }}
          />
        </FieldRow>
        <FieldRow>
          <NumberCombobox
            icon={ParagraphSpacingIcon}
            ariaLabel={t('lineHeight')}
            presetsLabel={t('lineHeightPresets')}
            mixedLabel={mixed}
            unsetLabel={auto === null ? t('auto') : String(auto)}
            value={lineHeight}
            presets={lineHeightPresets}
            min={LINE_SPACING.min * 100}
            max={LINE_SPACING.max * 100}
            precision={0}
            suffix="%"
            {...wire(
              (percent, mode) => actions.setLineSpacing(percent / 100, mode),
              actions.setLineSpacingEach,
            )}
            onCommit={(percent) =>
              actions.setLineSpacing(percent === null ? null : percent / 100, 'commit')
            }
          />
          <NumberField
            icon={LetterSpacingIcon}
            ariaLabel={t('letterSpacing')}
            mixedLabel={mixed}
            value={look.letterSpacingPt}
            min={LETTER_SPACING_PT.min}
            max={LETTER_SPACING_PT.max}
            step={0.1}
            suffix={t('pt')}
            {...wire(actions.setLetterSpacing, actions.setLetterSpacingEach)}
          />
        </FieldRow>
        <FieldRow>
          <Segmented
            ariaLabel={t('textAlign')}
            value={look.align}
            options={TEXT_ALIGNS.map((option) => ({
              ...option,
              label: t(`textAligns.${option.value}`),
            }))}
            onChange={actions.setAlign}
          />
          <Segmented
            ariaLabel={t('verticalAlign')}
            value={look.verticalAlign}
            options={VERTICAL_ALIGNS.map((option) => ({
              ...option,
              label: t(`verticalAligns.${option.value}`),
            }))}
            onChange={actions.setVerticalAlign}
          />
        </FieldRow>
      </Section>
      <Section title={t('fill')}>
        <ColorField
          ariaLabel={t('textColor')}
          palette={designSystem.palette}
          value={look.color ?? undefined}
          mixedLabel={mixed}
          roleLabel={(role: ColorRole) => palette(role)}
          onChange={(value) => {
            const hex = value === null ? null : colorHex(designSystem.palette, value);
            if (value !== null && hex !== null) actions.setColor(value, hex, 'commit');
          }}
          onPreview={(hex) => actions.setColor(hex, hex, live ? 'preview' : 'commit')}
          onPreviewEnd={live ? onPreviewEnd : undefined}
        />
      </Section>
    </>
  );
}

/**
 * Картинка: вписать целиком или заполнить рамку с обрезкой. Растянуть нельзя — аудит ищет
 * искажённые картинки. Заменить — выбрать другой файл в ту же рамку.
 */
function ImageSection({
  images,
  onProps,
  onReplaceImage,
  onStartCrop,
  onResetCrop,
}: DesignPanelProps & { images: readonly ImageElement[] }) {
  const t = useTranslations('designPanel');
  const ids = images.map((element) => element.elementId);
  const fit = commonValue(images as SlideElement[], (element) =>
    isImage(element) ? element.fit : null,
  );
  const single = images.length === 1 ? images[0] : undefined;

  const replace = async () => {
    if (!single) return;
    const [file] = await pickImageFiles();
    if (!file) return;
    const { mediaPart } = await registerImage(file);
    onReplaceImage(single.elementId, mediaPart);
  };

  return (
    <Section title={t('image')}>
      <Segmented
        ariaLabel={t('fit')}
        value={fit}
        options={FITS.map((option) => ({ ...option, label: t(`fits.${option.value}`) }))}
        onChange={(value) => onProps(ids, { fit: value })}
      />
      {single ? (
        <button
          type="button"
          onClick={() => void replace()}
          className={cn(
            'flex h-7 items-center justify-center gap-1.5 rounded-md bg-muted/60 text-xs text-foreground outline-none',
            'ring-1 ring-transparent transition-colors duration-100 hover:ring-border',
            'focus-visible:ring-ring',
          )}
        >
          <HugeiconsIcon icon={ImageUploadIcon} size={14} strokeWidth={1.5} color="currentColor" />
          {t('replaceImage')}
        </button>
      ) : null}
      {single && (onStartCrop || (single.crop && onResetCrop)) ? (
        <div className="grid grid-cols-2 gap-2">
          {onStartCrop ? (
            <button
              type="button"
              onClick={() => onStartCrop(single.elementId)}
              className={cn(
                'flex h-7 items-center justify-center gap-1.5 rounded-md bg-muted/60 text-xs text-foreground outline-none',
                'ring-1 ring-transparent transition-colors duration-100 hover:ring-border',
                'focus-visible:ring-ring',
              )}
            >
              <HugeiconsIcon icon={CropIcon} size={14} strokeWidth={1.5} color="currentColor" />
              {t('cropImage')}
            </button>
          ) : null}
          {single.crop && onResetCrop ? (
            <button
              type="button"
              onClick={() => onResetCrop(single.elementId)}
              className={cn(
                'flex h-7 items-center justify-center rounded-md bg-muted/60 text-xs text-foreground outline-none',
                'ring-1 ring-transparent transition-colors duration-100 hover:ring-border',
                'focus-visible:ring-ring',
              )}
            >
              {t('resetCrop')}
            </button>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}

/** Заливка и обводка фигур; у линий — только линия и её концы. */
function DecorSections({
  designSystem,
  decors,
  onProps,
  onPropsEach,
  onPreviewEnd,
}: DesignPanelProps & { decors: readonly Decor[] }) {
  const t = useTranslations('designPanel');
  const palette = useTranslations('selectionBar.palette');
  const ids = decors.map((element) => element.elementId);
  const lines = decors.every((element) => element.shape === 'line');
  const noLines = decors.every((element) => element.shape !== 'line');
  const fills = decors.map((element) => element.fill ?? null);
  const fill = fills.every((value) => value === fills[0]) ? fills[0] : undefined;
  const stroked = decors.filter((element) => element.stroke);
  const bare = decors.filter((element) => !element.stroke);
  const strokeColors = stroked.map((element) => element.stroke?.color ?? null);
  const strokeColor =
    stroked.length === 0
      ? null
      : bare.length === 0 && strokeColors.every((value) => value === strokeColors[0])
        ? strokeColors[0]
        : undefined;
  const strokeWidth =
    bare.length === 0
      ? common(stroked.map((element) => (element.stroke?.widthEmu ?? 0) / EMU_PER_PT))
      : null;
  const dash =
    bare.length === 0
      ? commonString(stroked.map((element) => element.stroke?.dash ?? 'solid'))
      : null;
  const roleLabel = (role: ColorRole) => palette(role);
  const fallbackStroke: ColorValue = designSystem.palette.some((entry) => entry.role === 'text')
    ? 'text'
    : (designSystem.palette[0]?.role ?? 'text');
  const strokedIds = stroked.map((element) => element.elementId);

  const setStrokeColor = (color: ColorValue | null, mode: EditMode = 'commit') => {
    if (color === null) {
      onProps(ids, { stroke: null }, mode);
      return;
    }
    // Фигура без обводки получает её целиком, у остальных меняется только цвет.
    const entries: PropsEntry[] = [];
    if (bare.length > 0) {
      entries.push({
        elementIds: bare.map((element) => element.elementId),
        props: { stroke: freshStroke(color) },
      });
    }
    if (stroked.length > 0) entries.push({ elementIds: strokedIds, props: { stroke: { color } } });
    onPropsEach(entries, mode);
  };

  return (
    <>
      {noLines ? (
        <Section title={t('fill')}>
          <ColorField
            ariaLabel={t('fill')}
            palette={designSystem.palette}
            value={fill}
            roleLabel={roleLabel}
            noneLabel={t('none')}
            mixedLabel={t('mixed')}
            onChange={(value) => onProps(ids, { fill: value })}
            onPreview={(hex) => onProps(ids, { fill: hex }, 'preview')}
            onPreviewEnd={onPreviewEnd}
          />
        </Section>
      ) : null}
      <Section title={lines ? t('line') : t('stroke')}>
        <ColorField
          ariaLabel={lines ? t('line') : t('stroke')}
          palette={designSystem.palette}
          value={strokeColor}
          roleLabel={roleLabel}
          noneLabel={lines ? undefined : t('none')}
          mixedLabel={t('mixed')}
          onChange={(value) => setStrokeColor(value)}
          onPreview={(hex) => setStrokeColor(hex, 'preview')}
          onPreviewEnd={onPreviewEnd}
        />
        {stroked.length > 0 ? (
          <FieldRow>
            <NumberField
              icon={MinusSignIcon}
              ariaLabel={t('strokeWidth')}
              mixedLabel={t('mixed')}
              value={strokeWidth}
              step={0.5}
              min={0.25}
              max={50}
              precision={2}
              suffix={t('pt')}
              {...edits(
                (value, mode) =>
                  onProps(strokedIds, { stroke: { widthEmu: value * EMU_PER_PT } }, mode),
                (apply, mode) =>
                  onPropsEach(
                    stroked.map((element) => ({
                      elementIds: [element.elementId],
                      props: {
                        stroke: {
                          widthEmu:
                            apply((element.stroke?.widthEmu ?? 0) / EMU_PER_PT) * EMU_PER_PT,
                        },
                      },
                    })),
                    mode,
                  ),
                onPreviewEnd,
              )}
            />
            <Segmented
              ariaLabel={t('dash')}
              value={dash}
              options={DASHES.map((option) => ({ ...option, label: t(`dashes.${option.value}`) }))}
              onChange={(value) => onProps(strokedIds, { stroke: { dash: value } })}
            />
          </FieldRow>
        ) : null}
        {lines ? (
          <LineEnds decors={decors} onPropsEach={onPropsEach} strokeColor={fallbackStroke} />
        ) : null}
      </Section>
    </>
  );
}

/** Концы линии: стрелка в начале и в конце. */
function LineEnds({
  decors,
  onPropsEach,
  strokeColor,
}: {
  decors: readonly Decor[];
  onPropsEach: DesignPanelProps['onPropsEach'];
  strokeColor: ColorValue;
}) {
  const t = useTranslations('designPanel');
  const head = decors.every((element) => element.stroke?.head === 'arrow');
  const tail = decors.every((element) => element.stroke?.tail === 'arrow');
  const toggle = (end: 'head' | 'tail', on: boolean) => {
    const mark = on ? 'arrow' : 'none';
    // Обводка сливается с той, что у линии уже есть; линии без неё получают её целиком.
    const stroked = decors.filter((element) => element.stroke).map((element) => element.elementId);
    const bare = decors.filter((element) => !element.stroke).map((element) => element.elementId);
    const entries: PropsEntry[] = [];
    if (stroked.length > 0)
      entries.push({ elementIds: stroked, props: { stroke: { [end]: mark } } });
    if (bare.length > 0) {
      entries.push({
        elementIds: bare,
        props: { stroke: { ...freshStroke(strokeColor), [end]: mark } },
      });
    }
    onPropsEach(entries);
  };
  return (
    <div className="flex items-center gap-1">
      <span className="flex-1 text-xs text-muted-foreground">{t('ends')}</span>
      <span className="rotate-180">
        <IconButton
          icon={ArrowRight01Icon}
          label={t('headArrow')}
          pressed={head}
          onClick={() => toggle('head', !head)}
        />
      </span>
      <IconButton
        icon={ArrowRight01Icon}
        label={t('tailArrow')}
        pressed={tail}
        onClick={() => toggle('tail', !tail)}
      />
    </div>
  );
}
