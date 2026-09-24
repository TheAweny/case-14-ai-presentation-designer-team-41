'use client';

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
  DiamondIcon,
  LayerBringForwardIcon,
  LayerBringToFrontIcon,
  LayerSendBackwardIcon,
  LayerSendToBackIcon,
  MinusSignIcon,
  Rotate01Icon,
  SquareIcon,
  SquareRoundCornerIcon,
  TransparencyIcon,
  TriangleIcon,
  DashedLine02Icon,
  TextAlignCenterIcon,
  TextAlignJustifyLeftIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
  TextBoldIcon,
  TextItalicIcon,
  TextUnderlineIcon,
  ArrowDown01Icon,
  FitToScreenIcon,
  ImageCropIcon,
  ImageUploadIcon,
  Add01Icon,
  LockIcon,
  LockOpenIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type {
  ColorRole,
  DecorShape,
  DesignSystem,
  ImageFit,
  ParagraphAlign,
  SlideElement,
  SlideIr,
  Stroke,
  StrokeDash,
  TypeRole,
  VerticalAlign,
} from '@lct/contracts';
import type { ArrangeTarget, ElementProps } from '@lct/deck-ops';
import { EMU_PER_PT } from '@lct/slide-renderer';
import type { MouseEvent } from 'react';
import type { Alignment } from '@/components/editor/slide-geometry';
import type { ElementMove } from '@/components/editor/use-deck-history';
import {
  FieldRow,
  IconButton,
  NumberField,
  Section,
  Segmented,
  SwatchPicker,
} from '@/components/editor/inspector/controls';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { pickImageFiles, registerImage } from '@/lib/image-files';
import { ChartSection } from '@/components/editor/inspector/chart-section';
import type { ChartData } from '@/components/editor/inspector/chart-data';
import {
  textLook,
  typeSteps,
  type TextElement,
  type TextLook,
} from '@/components/editor/inspector/text-model';
import {
  rangeMarks,
  setParagraphAlign,
  setRangeColor,
  setRangeSize,
  setRunFlag,
  type ActiveTextEditor,
} from '@/components/editor/active-text-editor';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { typeRoleOf } from '@lct/slide-renderer';
import {
  alignToSlide,
  commonValue,
  emuToPt,
  setBoxField,
  type BoxField,
} from '@/components/editor/inspector/selection-model';

/**
 * Что панель «Дизайн» умеет сделать со слайдом. Правки уходят в журнал колоды одной записью
 * на жест: число в поле — по Enter или уходу из поля, цвет — по клику.
 */
export type DesignPanelProps = {
  /** Открытый слайд. Пока колода пуста, его нет. */
  slide: SlideIr | undefined;
  designSystem: DesignSystem;
  selectedIds: readonly string[];
  /** Новые рамки объектов: один список на жест, не шаг на каждый пиксель. */
  onCommit: (moves: readonly ElementMove[]) => void;
  onRemove: () => void;
  /** Выровнять выделенные объекты между собой. */
  onAlign: (alignment: Alignment) => void;
  /** Кегль из шкалы шаблона — один `set-font-size` на весь текстовый объект. */
  onFontSize: (elementId: string, sizePt: number) => void;
  /** Роль палитры. В runs пишется её hex, в журнал — сама роль. */
  onColor: (elementId: string, colorRole: ColorRole, hex: string) => void;
  /** Кегль или цвет всем выделенным текстам — одной записью журнала. */
  onFontSizeAll: (elementIds: readonly string[], sizePt: number) => void;
  onColorAll: (elementIds: readonly string[], colorRole: ColorRole, hex: string) => void;
  /** Свойства вида: заливка, обводка, форма, поворот, прозрачность и остальное из `ElementProps`. */
  onProps: (elementIds: readonly string[], props: ElementProps) => void;
  /** Открытый на холсте набор: секция «Текст» правит его выделенный фрагмент. */
  textEditor: ActiveTextEditor | null;
  /** Порядок слоёв выделенного. */
  onArrange: (to: ArrangeTarget) => void;
  /** Новый файл в рамке картинки. */
  onReplaceImage: (elementId: string, mediaPart: string) => void;
  /** Фон слайда: роль палитры или null — как задал шаблон. */
  onSlideBackground: (background: ColorRole | null) => void;
  /** Строки и столбцы таблицы. */
  onTable: (elementId: string, action: TableAction) => void;
  /** Данные графика целиком: одна запись журнала на правку. */
  onChartData: (elementId: string, data: ChartData) => void;
  onChartAxes: (elementId: string, titles: { xTitle?: string; yTitle?: string }) => void;
};

export type TableAction = 'add-row' | 'remove-row' | 'add-column' | 'remove-column';

const ALIGNMENTS = [
  { id: 'left', icon: AlignLeftIcon },
  { id: 'center', icon: AlignHorizontalCenterIcon },
  { id: 'right', icon: AlignRightIcon },
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

/** Обводка, которую получает фигура без неё: тонкая сплошная линия цвета текста. */
function freshStroke(color: ColorRole): Stroke {
  return { color, widthEmu: EMU_PER_PT, dash: 'solid', head: 'none', tail: 'none' };
}

type Decor = Extract<SlideElement, { kind: 'decor' }>;

function isDecor(element: SlideElement): element is Decor {
  return element.kind === 'decor';
}

function isText(element: SlideElement): element is TextElement {
  return element.kind === 'text';
}

type ImageElement = Extract<SlideElement, { kind: 'image' }>;

function isImage(element: SlideElement): element is ImageElement {
  return element.kind === 'image';
}

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

/** Свойства выделения, по секциям, как в панели Design у Figma. */
export function DesignPanel(props: DesignPanelProps) {
  const names = useTranslations('selectionBar');
  const { slide, selectedIds } = props;
  const selected = slide
    ? slide.elements.filter((element) => selectedIds.includes(element.elementId))
    : [];

  if (!slide) return null;
  if (selected.length === 0) return <SlideSection {...props} slide={slide} />;

  const single = selected.length === 1 ? selected[0] : undefined;
  const decors = selected.every(isDecor) ? (selected as Decor[]) : [];
  const texts = selected.every(isText) ? (selected as TextElement[]) : [];
  const images = selected.every(isImage) ? (selected as ImageElement[]) : [];
  const table = single?.kind === 'table' ? single : undefined;
  const chart = single?.kind === 'chart' ? single : undefined;

  return (
    <div className="flex flex-col">
      <div className="flex min-h-10 items-center gap-2 border-b border-border pr-2 pl-4">
        <h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
          {single ? names(`roles.${single.role}`) : names('count', { count: selected.length })}
        </h2>
        <LockToggle {...props} selected={selected} />
      </div>
      <LayoutSection {...props} slide={slide} selected={selected} />
      <LayerSection {...props} selected={selected} />
      {texts.length > 0 ? <TextSection {...props} texts={texts} /> : null}
      {images.length > 0 ? <ImageSection {...props} images={images} /> : null}
      {table ? <TableSection {...props} table={table} /> : null}
      {chart ? <ChartSection {...props} chart={chart} /> : null}
      {decors.length > 0 ? <DecorSections {...props} decors={decors} /> : null}
    </div>
  );
}

/**
 * Ничего не выделено — панель показывает сам слайд, как Figma показывает фрейм. Подсказка
 * остаётся: без неё пустая панель выглядит сломанной.
 */
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

function SlideSection({
  slide,
  designSystem,
  onSlideBackground,
}: DesignPanelProps & { slide: SlideIr }) {
  const t = useTranslations('designPanel');
  const palette = useTranslations('selectionBar.palette');
  return (
    <div className="flex flex-col">
      <div className="flex min-h-10 items-center border-b border-border px-4">
        <h2 className="truncate text-xs font-semibold text-foreground">{t('slide')}</h2>
      </div>
      <Section title={t('background')}>
        <SwatchPicker
          ariaLabel={t('background')}
          palette={designSystem.palette}
          value={slide.background ?? null}
          roleLabel={(role) => palette(role)}
          noneLabel={t('templateBackground')}
          onChange={onSlideBackground}
        />
      </Section>
      <p className="px-4 py-3 text-xs text-balance text-muted-foreground">{t('emptyHint')}</p>
    </div>
  );
}

function LayoutSection({
  slide,
  selected,
  onCommit,
  onAlign,
  onProps,
}: DesignPanelProps & { slide: SlideIr; selected: readonly SlideElement[] }) {
  const t = useTranslations('designPanel');
  const aligns = useTranslations('selectionBar.align');
  const mixed = t('mixed');
  const ids = selected.map((element) => element.elementId);

  const align = (alignment: Alignment) => {
    if (selected.length > 1) onAlign(alignment);
    else onCommit(alignToSlide(selected, alignment, slide));
  };
  const field = (name: BoxField) => {
    const value = commonValue(selected, (element) => element.box[name]);
    return value === null ? null : emuToPt(value);
  };
  const commitField = (name: BoxField) => (value: number) => {
    const moves = setBoxField(selected, name, value);
    if (moves.length > 0) onCommit(moves);
  };
  const rotation = commonValue(selected, (element) => element.rotation ?? 0);

  return (
    <Section title={t('layout')}>
      <div className="flex items-center justify-between rounded-md bg-muted/60 p-0.5">
        {ALIGNMENTS.map(({ id, icon }) => (
          <IconButton key={id} icon={icon} label={aligns(id)} onClick={() => align(id)} />
        ))}
      </div>
      <FieldRow>
        <NumberField
          label="X"
          ariaLabel={t('x')}
          mixedLabel={mixed}
          value={field('x')}
          onCommit={commitField('x')}
        />
        <NumberField
          label="Y"
          ariaLabel={t('y')}
          mixedLabel={mixed}
          value={field('y')}
          onCommit={commitField('y')}
        />
      </FieldRow>
      <FieldRow>
        <NumberField
          label="W"
          ariaLabel={t('width')}
          mixedLabel={mixed}
          value={field('cx')}
          min={1}
          onCommit={commitField('cx')}
        />
        <NumberField
          label="H"
          ariaLabel={t('height')}
          mixedLabel={mixed}
          value={field('cy')}
          min={1}
          onCommit={commitField('cy')}
        />
      </FieldRow>
      <FieldRow>
        <NumberField
          icon={Rotate01Icon}
          ariaLabel={t('rotation')}
          mixedLabel={mixed}
          value={rotation}
          suffix="°"
          onCommit={(value) => onProps(ids, { rotation: value })}
        />
      </FieldRow>
    </Section>
  );
}

function LayerSection({
  selected,
  onArrange,
  onProps,
}: DesignPanelProps & { selected: readonly SlideElement[] }) {
  const t = useTranslations('designPanel');
  const ids = selected.map((element) => element.elementId);
  const opacity = commonValue(selected, (element) => element.opacity ?? 1);

  return (
    <Section
      title={t('layer')}
      actions={ARRANGE.map(({ id, icon }) => (
        <IconButton key={id} icon={icon} label={t(`arrange.${id}`)} onClick={() => onArrange(id)} />
      ))}
    >
      <FieldRow>
        <NumberField
          icon={TransparencyIcon}
          ariaLabel={t('opacity')}
          mixedLabel={t('mixed')}
          value={opacity === null ? null : Math.round(opacity * 100)}
          min={0}
          max={100}
          suffix="%"
          onCommit={(value) => onProps(ids, { opacity: value / 100 })}
        />
      </FieldRow>
    </Section>
  );
}

/** Что умеет секция «Текст»: одинаково для всего блока и для фрагмента в открытом наборе. */
interface TextActions {
  readonly look: TextLook;
  setSize(sizePt: number): void;
  setBold(on: boolean): void;
  setItalic(on: boolean): void;
  setUnderline(on: boolean): void;
  setAlign(align: ParagraphAlign): void;
  setVerticalAlign(align: VerticalAlign): void;
  setColor(role: ColorRole, hex: string): void;
}

/**
 * Текст. Выделен блок — правки на весь блок. Открыт набор — на выделенные слова и абзацы, как
 * в Figma; в журнал они попадут одним `set-text`, когда набор закроется.
 */
function TextSection(props: DesignPanelProps & { texts: readonly TextElement[] }) {
  const { texts, textEditor } = props;
  const only = texts.length === 1 ? texts[0] : undefined;
  if (textEditor && only && only.elementId === textEditor.elementId) {
    return <RangeText {...props} editor={textEditor.editor} element={only} />;
  }
  return <WholeText {...props} />;
}

function WholeText({
  designSystem,
  texts,
  onFontSizeAll,
  onColorAll,
  onProps,
}: DesignPanelProps & { texts: readonly TextElement[] }) {
  const t = useTranslations('designPanel');
  const ids = texts.map((element) => element.elementId);
  const look = textLook(texts, designSystem);
  return (
    <TextControls
      title={t('text')}
      designSystem={designSystem}
      actions={{
        look,
        setSize: (sizePt) => onFontSizeAll(ids, sizePt),
        setBold: (on) => onProps(ids, { bold: on }),
        setItalic: (on) => onProps(ids, { italic: on }),
        setUnderline: (on) => onProps(ids, { underline: on }),
        setAlign: (align) => onProps(ids, { align }),
        setVerticalAlign: (verticalAlign) => onProps(ids, { verticalAlign }),
        setColor: (role, hex) => onColorAll(ids, role, hex),
      }}
    />
  );
}

/** Кнопки панели не забирают фокус у поля: иначе набор закрылся бы от первого клика. */
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
}: DesignPanelProps & { editor: Editor; element: TextElement }) {
  const t = useTranslations('designPanel');
  const marks = useEditorState({ editor, selector: ({ editor: current }) => rangeMarks(current) });
  const style = designSystem.typeScale.find((entry) => entry.role === typeRoleOf(element.role));
  const colorRole = marks.color
    ? (designSystem.palette.find(
        (entry) => `#${entry.hex}`.toLowerCase() === marks.color?.toLowerCase(),
      )?.role ?? null)
    : (style?.colorRole ?? null);
  const look: TextLook = {
    sizePt: marks.sizePt ?? style?.sizePt ?? null,
    color: colorRole,
    bold: marks.bold || (marks.boldMode !== 'false' && (style?.bold ?? false)),
    italic: marks.italic || (marks.italicMode !== 'false' && (style?.italic ?? false)),
    underline: marks.underlineMode === 'true',
    align: marks.align ?? 'left',
    verticalAlign: element.verticalAlign ?? 'top',
  };
  return (
    <div data-text-panel="" onMouseDown={keepEditorFocus}>
      <TextControls
        title={t('textSelection')}
        hint={t('textSelectionHint')}
        designSystem={designSystem}
        actions={{
          look,
          setSize: (sizePt) => setRangeSize(editor, sizePt),
          setBold: (on) => setRunFlag(editor, 'bold', on),
          setItalic: (on) => setRunFlag(editor, 'italic', on),
          setUnderline: (on) => setRunFlag(editor, 'underline', on),
          setAlign: (align) => setParagraphAlign(editor, align),
          // Вертикальная привязка — свойство рамки, а не слов: её набор не трогает.
          setVerticalAlign: (verticalAlign) => onProps([element.elementId], { verticalAlign }),
          setColor: (_role, hex) => setRangeColor(editor, hex),
        }}
      />
    </div>
  );
}

function TextControls({
  title,
  hint,
  designSystem,
  actions,
}: {
  title: string;
  hint?: string;
  designSystem: DesignSystem;
  actions: TextActions;
}) {
  const t = useTranslations('designPanel');
  const scale = useTranslations('selectionBar.type');
  const palette = useTranslations('selectionBar.palette');
  const { look } = actions;
  const steps = typeSteps(designSystem);
  const current = steps.find((step) => step.sizePt === look.sizePt);

  return (
    <Section title={title}>
      {hint ? <p className="-mt-1 text-xs text-balance text-muted-foreground">{hint}</p> : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('fontSize')}
            className={cn(
              'flex h-7 w-full items-center gap-2 rounded-md bg-muted/60 px-2 text-xs outline-none',
              'ring-1 ring-transparent transition-colors duration-100 hover:ring-border',
              'focus-visible:ring-ring data-[state=open]:ring-ring',
            )}
          >
            <span className="min-w-0 flex-1 truncate text-left text-foreground">
              {current
                ? scale(current.role as TypeRole)
                : look.sizePt === null
                  ? t('mixed')
                  : t('offScale')}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {look.sizePt === null ? '' : `${look.sizePt} ${t('pt')}`}
            </span>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              size={12}
              strokeWidth={1.5}
              color="currentColor"
              className="text-muted-foreground"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          {steps.map((step) => (
            <DropdownMenuItem key={step.role} onSelect={() => actions.setSize(step.sizePt)}>
              {scale(step.role as TypeRole)}
              <span className="ml-auto pl-3 text-muted-foreground tabular-nums">{step.sizePt}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5">
          <IconButton
            icon={TextBoldIcon}
            label={t('bold')}
            pressed={look.bold}
            onClick={() => actions.setBold(!look.bold)}
          />
          <IconButton
            icon={TextItalicIcon}
            label={t('italic')}
            pressed={look.italic}
            onClick={() => actions.setItalic(!look.italic)}
          />
          <IconButton
            icon={TextUnderlineIcon}
            label={t('underline')}
            pressed={look.underline}
            onClick={() => actions.setUnderline(!look.underline)}
          />
        </div>
        <div className="min-w-0 flex-1">
          <Segmented
            ariaLabel={t('textAlign')}
            value={look.align}
            options={TEXT_ALIGNS.map((option) => ({
              ...option,
              label: t(`textAligns.${option.value}`),
            }))}
            onChange={actions.setAlign}
          />
        </div>
      </div>
      <Segmented
        ariaLabel={t('verticalAlign')}
        value={look.verticalAlign}
        options={VERTICAL_ALIGNS.map((option) => ({
          ...option,
          label: t(`verticalAligns.${option.value}`),
        }))}
        onChange={actions.setVerticalAlign}
      />
      <SwatchPicker
        ariaLabel={t('textColor')}
        palette={designSystem.palette}
        value={look.color ?? undefined}
        roleLabel={(role) => palette(role)}
        onChange={(role) => {
          const entry = designSystem.palette.find((item) => item.role === role);
          if (entry) actions.setColor(entry.role, entry.hex);
        }}
      />
    </Section>
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
    </Section>
  );
}

/**
 * Таблица: размер сеткой. Сами ячейки правятся на слайде — двойной клик по таблице.
 */
function TableSection({
  table,
  onTable,
}: DesignPanelProps & { table: Extract<SlideElement, { kind: 'table' }> }) {
  const t = useTranslations('designPanel');
  const rows = table.rows.length;
  const columns = table.headers.length;
  const stepper = (
    label: string,
    value: number,
    min: number,
    add: TableAction,
    remove: TableAction,
  ) => (
    <div className="flex items-center gap-1">
      <span className="flex-1 text-xs text-muted-foreground">{label}</span>
      <IconButton
        icon={MinusSignIcon}
        label={t(remove === 'remove-row' ? 'removeRow' : 'removeColumn')}
        disabled={value <= min}
        onClick={() => onTable(table.elementId, remove)}
      />
      <span className="w-6 text-center text-xs tabular-nums text-foreground">{value}</span>
      <IconButton
        icon={Add01Icon}
        label={t(add === 'add-row' ? 'addRow' : 'addColumn')}
        onClick={() => onTable(table.elementId, add)}
      />
    </div>
  );
  return (
    <Section title={t('table')}>
      {stepper(t('rows'), rows, 1, 'add-row', 'remove-row')}
      {stepper(t('columns'), columns, 1, 'add-column', 'remove-column')}
      <p className="text-xs text-balance text-muted-foreground">{t('tableHint')}</p>
    </Section>
  );
}

function DecorSections({
  designSystem,
  decors,
  onProps,
}: DesignPanelProps & { decors: readonly Decor[] }) {
  const t = useTranslations('designPanel');
  const palette = useTranslations('selectionBar.palette');
  const ids = decors.map((element) => element.elementId);
  const lines = decors.every((element) => element.shape === 'line');
  const noLines = decors.every((element) => element.shape !== 'line');
  const shape = commonValue(decors as SlideElement[], (element) =>
    isDecor(element) ? (element.shape ?? null) : null,
  );
  const fill = commonValue(decors as SlideElement[], (element) =>
    isDecor(element) ? (element.fill ?? null) : null,
  );
  const strokeColor = commonValue(decors as SlideElement[], (element) =>
    isDecor(element) ? (element.stroke?.color ?? null) : null,
  );
  const strokes = decors.flatMap((element) => (element.stroke ? [element.stroke] : []));
  const allStroked = strokes.length === decors.length;
  const strokeWidth = allStroked ? commonNumber(strokes.map((stroke) => stroke.widthEmu)) : null;
  const dash = allStroked ? commonString(strokes.map((stroke) => stroke.dash)) : null;
  const radius = commonValue(decors as SlideElement[], (element) =>
    isDecor(element) ? (element.cornerRadius ?? null) : null,
  );
  const roleLabel = (role: ColorRole) => palette(role);
  const fallbackStroke = designSystem.palette.some((entry) => entry.role === 'text')
    ? 'text'
    : (designSystem.palette[0]?.role ?? 'text');

  const setStrokeColor = (color: ColorRole | null) => {
    if (color === null) {
      onProps(ids, { stroke: null });
      return;
    }
    // Фигура без обводки получает её целиком, у остальных меняется только цвет.
    const bare = decors.filter((element) => !element.stroke).map((element) => element.elementId);
    const stroked = decors.filter((element) => element.stroke).map((element) => element.elementId);
    if (bare.length > 0) onProps(bare, { stroke: freshStroke(color) });
    if (stroked.length > 0) onProps(stroked, { stroke: { color } });
  };

  return (
    <>
      {noLines ? (
        <Section title={t('shape')}>
          <Segmented
            ariaLabel={t('shape')}
            value={shape}
            options={SHAPES.map((option) => ({ ...option, label: t(`shapes.${option.value}`) }))}
            onChange={(value) => onProps(ids, { shape: value })}
          />
          {shape === 'round-rect' ? (
            <FieldRow>
              <NumberField
                icon={SquareRoundCornerIcon}
                ariaLabel={t('radius')}
                mixedLabel={t('mixed')}
                value={radius === null ? null : Math.round(radius * 200)}
                min={0}
                max={100}
                suffix="%"
                onCommit={(value) => onProps(ids, { cornerRadius: value / 200 })}
              />
            </FieldRow>
          ) : null}
        </Section>
      ) : null}
      {noLines ? (
        <Section title={t('fill')}>
          <SwatchPicker
            ariaLabel={t('fill')}
            palette={designSystem.palette}
            value={fill}
            roleLabel={roleLabel}
            noneLabel={t('none')}
            onChange={(value) => onProps(ids, { fill: value })}
          />
        </Section>
      ) : null}
      <Section title={lines ? t('line') : t('stroke')}>
        <SwatchPicker
          ariaLabel={lines ? t('line') : t('stroke')}
          palette={designSystem.palette}
          value={allStroked ? strokeColor : strokes.length === 0 ? null : undefined}
          roleLabel={roleLabel}
          noneLabel={lines ? undefined : t('none')}
          onChange={setStrokeColor}
        />
        {strokes.length > 0 ? (
          <FieldRow>
            <NumberField
              icon={MinusSignIcon}
              ariaLabel={t('strokeWidth')}
              mixedLabel={t('mixed')}
              value={strokeWidth === null ? null : strokeWidth / EMU_PER_PT}
              step={0.5}
              min={0.25}
              max={50}
              suffix={t('pt')}
              onCommit={(value) =>
                onProps(
                  decors.filter((element) => element.stroke).map((element) => element.elementId),
                  { stroke: { widthEmu: Math.max(1, Math.round(value * EMU_PER_PT)) } },
                )
              }
            />
            <Segmented
              ariaLabel={t('dash')}
              value={dash as StrokeDash | null}
              options={DASHES.map((option) => ({ ...option, label: t(`dashes.${option.value}`) }))}
              onChange={(value) =>
                onProps(
                  decors.filter((element) => element.stroke).map((element) => element.elementId),
                  { stroke: { dash: value } },
                )
              }
            />
          </FieldRow>
        ) : null}
        {lines ? <LineEnds decors={decors} onProps={onProps} strokeColor={fallbackStroke} /> : null}
      </Section>
    </>
  );
}

/** Концы линии: стрелка в начале и в конце. */
function LineEnds({
  decors,
  onProps,
  strokeColor,
}: {
  decors: readonly Decor[];
  onProps: DesignPanelProps['onProps'];
  strokeColor: ColorRole;
}) {
  const t = useTranslations('designPanel');
  const head = decors.every((element) => element.stroke?.head === 'arrow');
  const tail = decors.every((element) => element.stroke?.tail === 'arrow');
  const toggle = (end: 'head' | 'tail', on: boolean) => {
    const mark = on ? 'arrow' : 'none';
    // Обводка сливается с той, что у линии уже есть; линии без неё получают её целиком.
    const stroked = decors.filter((element) => element.stroke).map((element) => element.elementId);
    const bare = decors.filter((element) => !element.stroke).map((element) => element.elementId);
    if (stroked.length > 0) onProps(stroked, { stroke: { [end]: mark } });
    if (bare.length > 0) onProps(bare, { stroke: { ...freshStroke(strokeColor), [end]: mark } });
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

function commonNumber(values: readonly number[]): number | null {
  const [first, ...rest] = values;
  if (first === undefined) return null;
  return rest.every((value) => value === first) ? first : null;
}

function commonString(values: readonly string[]): string | null {
  const [first, ...rest] = values;
  if (first === undefined) return null;
  return rest.every((value) => value === first) ? first : null;
}
