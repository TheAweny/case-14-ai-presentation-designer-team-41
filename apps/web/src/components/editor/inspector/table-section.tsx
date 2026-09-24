'use client';

import { useTranslations } from 'next-intl';
import {
  Add01Icon,
  AlignBottomIcon,
  AlignTopIcon,
  AlignVerticalCenterIcon,
  BorderFullIcon,
  BorderHorizontalIcon,
  BorderVerticalIcon,
  DistributeHorizontalCenterIcon,
  DistributeVerticalCenterIcon,
  Eraser01Icon,
  MinusSignIcon,
  TextAlignCenterIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
  TextBoldIcon,
  TextItalicIcon,
  TextUnderlineIcon,
} from '@hugeicons/core-free-icons';
import type {
  ColorRole,
  ColorValue,
  DesignSystem,
  ParagraphAlign,
  SlideElement,
  SlideIr,
  TableBorders,
  VerticalAlign,
} from '@lct/contracts';
import type { TableCellStyle } from '@lct/contracts';
import type { TableRange } from '@lct/deck-ops';
import { EMU_PER_PT, slideSizeOf, tableBordersOf, typeRoleOf } from '@lct/slide-renderer';
import { useActiveTable } from '@/components/editor/active-table';
import {
  cellsOf,
  commonLook,
  hasOwnLook,
  toggledFlag,
  wholeTable,
  type StyleFlag,
} from '@/components/editor/table-grid';
import type { TableOps } from '@/components/editor/use-table-ops';
import type { EditMode } from '@/components/editor/use-deck-history';
import {
  ColorField,
  FieldRow,
  IconButton,
  NumberField,
  Section,
  Segmented,
} from '@/components/editor/inspector/controls';
import { cn } from '@/lib/utils';

type TableElement = Extract<SlideElement, { kind: 'table' }>;

/** Действия со строками и столбцами из панели: в конец таблицы и с конца. */
export type TableAction = 'add-row' | 'remove-row' | 'add-column' | 'remove-column';

const ALIGNS = [
  { value: 'left', icon: TextAlignLeftIcon },
  { value: 'center', icon: TextAlignCenterIcon },
  { value: 'right', icon: TextAlignRightIcon },
] as const satisfies readonly { value: ParagraphAlign; icon: unknown }[];

const VERTICAL_ALIGNS = [
  { value: 'top', icon: AlignTopIcon },
  { value: 'middle', icon: AlignVerticalCenterIcon },
  { value: 'bottom', icon: AlignBottomIcon },
] as const satisfies readonly { value: VerticalAlign; icon: unknown }[];

const FLAGS = [
  { flag: 'bold', icon: TextBoldIcon },
  { flag: 'italic', icon: TextItalicIcon },
  { flag: 'underline', icon: TextUnderlineIcon },
] as const satisfies readonly { flag: StyleFlag; icon: unknown }[];

const RULES = [
  { key: 'horizontal', icon: BorderHorizontalIcon, label: 'bordersHorizontal' },
  { key: 'vertical', icon: BorderVerticalIcon, label: 'bordersVertical' },
  { key: 'outer', icon: BorderFullIcon, label: 'bordersOuter' },
] as const;

const ALL_LOOK: readonly (keyof TableCellStyle)[] = [
  'fill',
  'color',
  'bold',
  'italic',
  'underline',
  'align',
  'verticalAlign',
];

/** Переключатель в строку: подпись слева, тумблер справа, как в панели Figma. */
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex h-7 items-center justify-between gap-2 rounded-md text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span>{label}</span>
      <span
        aria-hidden
        className={cn(
          'relative h-4 w-7 shrink-0 rounded-full transition-colors duration-100 motion-reduce:transition-none',
          checked ? 'bg-[var(--canvas-selection)]' : 'bg-muted-foreground/30',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-3 rounded-full bg-background shadow-sm transition-transform duration-100 motion-reduce:transition-none',
            checked ? 'translate-x-3.5' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  );
}

/**
 * Таблица в панели: размер сеткой, вид выделенных ячеек (или всей таблицы, если на холсте
 * ничего не выделено), стиль таблицы и линии. Каждое действие — одна запись журнала, пикер
 * цвета показывает правку живьём.
 */
export function TableSection({
  table,
  slide,
  designSystem,
  ops,
  onTable,
}: {
  table: TableElement;
  slide: SlideIr;
  designSystem: DesignSystem;
  ops: TableOps | undefined;
  onTable: (elementId: string, action: TableAction) => void;
}) {
  const t = useTranslations('designPanel');
  const own = useTranslations('tablePanel');
  const palette = useTranslations('selectionBar.palette');
  const active = useActiveTable();
  const id = table.elementId;
  const range: TableRange = active?.elementId === id ? active.range : wholeTable(table);
  const whole =
    active?.elementId !== id || cellsOf(range).length === cellsOf(wholeTable(table)).length;
  const roleLabel = (role: ColorRole) => palette(role);
  const typeColor: ColorValue =
    designSystem.typeScale.find((entry) => entry.role === typeRoleOf(table.role))?.colorRole ??
    'text';

  const rows = table.rows.length;
  const columns = table.headers.length;
  const stepper = (
    label: string,
    value: number,
    add: TableAction,
    remove: TableAction,
    addLabel: string,
    removeLabel: string,
  ) => (
    <div className="flex items-center gap-1">
      <span className="flex-1 text-xs text-muted-foreground">{label}</span>
      <IconButton
        icon={MinusSignIcon}
        label={removeLabel}
        disabled={value <= 1}
        onClick={() => onTable(id, remove)}
      />
      <span className="w-6 text-center text-xs text-foreground tabular-nums">{value}</span>
      <IconButton icon={Add01Icon} label={addLabel} onClick={() => onTable(id, add)} />
    </div>
  );

  const size = (
    <Section
      title={t('table')}
      actions={
        ops ? (
          <>
            <IconButton
              icon={DistributeHorizontalCenterIcon}
              label={own('distributeColumns')}
              disabled={!table.columnWidths}
              onClick={() => ops.distribute(id, 'columns')}
            />
            <IconButton
              icon={DistributeVerticalCenterIcon}
              label={own('distributeRows')}
              onClick={() => ops.distribute(id, 'rows')}
            />
          </>
        ) : null
      }
    >
      {stepper(t('rows'), rows, 'add-row', 'remove-row', t('addRow'), t('removeRow'))}
      {stepper(
        t('columns'),
        columns,
        'add-column',
        'remove-column',
        t('addColumn'),
        t('removeColumn'),
      )}
      <p className="text-xs text-balance text-muted-foreground">{t('tableHint')}</p>
    </Section>
  );
  if (!ops) return size;

  const style = (change: Partial<TableCellStyle>, mode?: EditMode) =>
    ops.style(id, range, { style: change }, mode);
  const fill = commonLook(table, range, 'fill');
  const color = commonLook(table, range, 'color');
  const align = commonLook(table, range, 'align');
  const verticalAlign = commonLook(table, range, 'verticalAlign');

  const borders = tableBordersOf(table, slideSizeOf(slide));
  const fallbackRule = tableBordersOf({}, slideSizeOf(slide));
  const setRule = (key: 'horizontal' | 'vertical' | 'outer') => {
    const base: TableBorders = borders ?? {
      ...(fallbackRule as TableBorders),
      horizontal: false,
      vertical: false,
      outer: false,
    };
    ops.props(id, { borders: { ...base, [key]: !base[key] } });
  };
  const setBorders = (change: Partial<TableBorders>, mode?: EditMode) => {
    if (!borders) return;
    ops.props(id, { borders: { ...borders, ...change } }, mode);
  };

  return (
    <>
      {size}
      <Section
        title={own('cells')}
        actions={
          <IconButton
            icon={Eraser01Icon}
            label={own('resetLook')}
            disabled={!hasOwnLook(table, range)}
            onClick={() => ops.style(id, range, { reset: ALL_LOOK })}
          />
        }
      >
        <p className="-mt-1 text-xs text-muted-foreground">
          {whole ? own('wholeTable') : own('selectedCells', { count: cellsOf(range).length })}
        </p>
        <ColorField
          ariaLabel={own('fill')}
          palette={designSystem.palette}
          value={fill}
          roleLabel={roleLabel}
          noneLabel={t('none')}
          mixedLabel={t('mixed')}
          onChange={(value) => style({ fill: value })}
          onPreview={(hex) => style({ fill: hex }, 'preview')}
          onPreviewEnd={ops.endPreview}
        />
        <ColorField
          ariaLabel={own('textColor')}
          palette={designSystem.palette}
          value={color === undefined ? undefined : (color ?? typeColor)}
          roleLabel={roleLabel}
          mixedLabel={t('mixed')}
          onChange={(value) => {
            if (value !== null) style({ color: value });
          }}
          onPreview={(hex) => style({ color: hex }, 'preview')}
          onPreviewEnd={ops.endPreview}
        />
        <FieldRow>
          <div
            role="group"
            aria-label={own('cells')}
            className="flex h-7 items-center justify-between rounded-md bg-muted/60"
          >
            {FLAGS.map(({ flag, icon }) => {
              const on = !toggledFlag(table, range, flag);
              return (
                <IconButton
                  key={flag}
                  icon={icon}
                  label={own(flag)}
                  pressed={on}
                  onClick={() => style({ [flag]: !on })}
                />
              );
            })}
          </div>
          <Segmented
            ariaLabel={own('align')}
            value={align === undefined || align === 'justify' ? null : align}
            options={ALIGNS.map((option) => ({
              ...option,
              label: t(`textAligns.${option.value}`),
            }))}
            onChange={(value) => style({ align: value })}
          />
        </FieldRow>
        <FieldRow>
          <Segmented
            ariaLabel={own('verticalAlign')}
            value={verticalAlign ?? null}
            options={VERTICAL_ALIGNS.map((option) => ({
              ...option,
              label: t(`verticalAligns.${option.value}`),
            }))}
            onChange={(value) => style({ verticalAlign: value })}
          />
        </FieldRow>
      </Section>
      <Section title={own('style')}>
        <Toggle
          label={own('headerRow')}
          checked={table.headerRow !== false}
          onChange={(checked) => ops.props(id, { headerRow: checked })}
        />
        <Toggle
          label={own('bandedRows')}
          checked={table.bandedRows === true}
          onChange={(checked) => ops.props(id, { bandedRows: checked })}
        />
        {table.bandedRows ? (
          <ColorField
            ariaLabel={own('bandFill')}
            palette={designSystem.palette}
            value={table.bandFill ?? 'surface'}
            roleLabel={roleLabel}
            onChange={(value) => ops.props(id, { bandFill: value })}
            onPreview={(hex) => ops.props(id, { bandFill: hex }, 'preview')}
            onPreviewEnd={ops.endPreview}
          />
        ) : null}
      </Section>
      <Section
        title={own('borders')}
        actions={RULES.map(({ key, icon, label }) => (
          <IconButton
            key={key}
            icon={icon}
            label={own(label)}
            pressed={borders?.[key] === true}
            onClick={() => setRule(key)}
          />
        ))}
      >
        {borders ? (
          <>
            <ColorField
              ariaLabel={own('borderColor')}
              palette={designSystem.palette}
              value={borders.color}
              roleLabel={roleLabel}
              onChange={(value) => {
                if (value !== null) setBorders({ color: value });
              }}
              onPreview={(hex) => setBorders({ color: hex }, 'preview')}
              onPreviewEnd={ops.endPreview}
            />
            <FieldRow>
              <NumberField
                icon={MinusSignIcon}
                ariaLabel={own('borderWidth')}
                mixedLabel={t('mixed')}
                value={Math.round((borders.widthEmu / EMU_PER_PT) * 100) / 100}
                step={0.25}
                min={0.25}
                max={20}
                precision={2}
                suffix={t('pt')}
                onCommit={(value) => setBorders({ widthEmu: value * EMU_PER_PT })}
                onPreview={(value) => setBorders({ widthEmu: value * EMU_PER_PT }, 'preview')}
                onPreviewEnd={ops.endPreview}
              />
            </FieldRow>
          </>
        ) : null}
      </Section>
    </>
  );
}
