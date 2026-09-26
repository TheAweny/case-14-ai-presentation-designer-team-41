'use client';

import { useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  Add01Icon,
  ChartAreaIcon,
  ChartColumnIcon,
  ChartLineData01Icon,
  BarChartHorizontalIcon,
  ClipboardPasteIcon,
  MinusSignIcon,
  PieChartIcon,
} from '@hugeicons/core-free-icons';
import type { ChartType, SlideElement } from '@lct/contracts';
import type { ElementProps } from '@lct/deck-ops';
import { cn } from '@/lib/utils';
import { IconButton, Section, Segmented } from '@/components/editor/inspector/controls';
import { parseNumber } from '@/components/editor/inspector/number-input';
import {
  addCategory,
  addSeries,
  removeCategory,
  removeSeries,
  sameData,
  setCategory,
  setSeriesName,
  setValue,
  type ChartData,
} from '@/components/editor/inspector/chart-data';
import {
  chartDataFromRows,
  isRange,
  parseDelimited,
  pasteRows,
  type ChartCell,
  type ChartNames,
} from '@/components/editor/inspector/chart-paste';

type ChartElement = Extract<SlideElement, { kind: 'chart' }>;

const TYPES = [
  { value: 'column', icon: ChartColumnIcon },
  { value: 'bar', icon: BarChartHorizontalIcon },
  { value: 'line', icon: ChartLineData01Icon },
  { value: 'area', icon: ChartAreaIcon },
  { value: 'pie', icon: PieChartIcon },
] as const satisfies readonly { value: ChartType; icon: unknown }[];

/**
 * Поле таблицы данных. Значение применяется по Enter или уходу из поля, Esc возвращает прежнее.
 * `key` с текущим значением пересоздаёт поле, когда данные поменяла отмена. Диапазон из буфера
 * (несколько ячеек из Excel или Google Таблиц) поле не берёт себе, а отдаёт `onPasteRange`.
 */
function CellInput({
  value,
  ariaLabel,
  numeric,
  onCommit,
  onPasteRange,
}: {
  value: string;
  ariaLabel: string;
  numeric?: boolean;
  onCommit: (text: string) => boolean;
  onPasteRange?: (text: string) => void;
}) {
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text/plain');
    if (!onPasteRange || !isRange(text)) return;
    event.preventDefault();
    // Поле возвращается к своему значению: диапазон ложится в данные целиком, одной правкой.
    event.currentTarget.value = value;
    onPasteRange(text);
  };
  const commit = (input: HTMLInputElement) => {
    if (input.value === value) return;
    if (!onCommit(input.value)) input.value = value;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.currentTarget.value = value;
      event.currentTarget.blur();
    }
  };
  return (
    <input
      key={value}
      defaultValue={value}
      aria-label={ariaLabel}
      inputMode={numeric ? 'decimal' : undefined}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={(event) => commit(event.currentTarget)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      className={cn(
        'h-6 w-full min-w-0 rounded-[5px] bg-transparent px-1.5 text-xs text-foreground outline-none',
        'hover:bg-muted focus:bg-background focus:ring-1 focus:ring-ring',
        numeric && 'text-right tabular-nums',
      )}
    />
  );
}

/**
 * График: тип, подписи осей и данные таблицей — категории строками, ряды столбцами, как в
 * таблице данных PowerPoint. Цвета рядов — из палитры шаблона по порядку, здесь их не выбирают.
 */
export function ChartSection({
  chart,
  onProps,
  onChartData,
  onChartAxes,
}: {
  chart: ChartElement;
  onProps: (elementIds: readonly string[], props: ElementProps) => void;
  onChartData: (elementId: string, data: ChartData) => void;
  onChartAxes: (elementId: string, titles: { xTitle?: string; yTitle?: string }) => void;
}) {
  const t = useTranslations('designPanel');
  const data: ChartData = { categories: chart.categories, series: chart.series };
  const apply = (next: ChartData) => {
    if (!sameData(next, data)) onChartData(chart.elementId, next);
  };
  const pie = chart.chartType === 'pie';
  const names: ChartNames = {
    series: (n) => t('seriesName', { n }),
    category: (n) => String(n),
  };
  /** Диапазон, вставленный в ячейку: ложится от неё вправо и вниз, одной записью журнала. */
  const pasteAt = (at: ChartCell) => (text: string) => {
    apply(pasteRows(data, parseDelimited(text), at, names));
  };
  // Подсказка под таблицей, когда кнопке «Вставить» нечего вставить или буфер закрыт.
  const [pasteNote, setPasteNote] = useState<'empty' | 'denied' | null>(null);
  const pasteClipboard = async () => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      setPasteNote('denied');
      return;
    }
    const next = chartDataFromRows(parseDelimited(text), names);
    if (!next) {
      setPasteNote('empty');
      return;
    }
    setPasteNote(null);
    apply(next);
  };

  return (
    <>
      <Section title={t('chart')}>
        <Segmented
          ariaLabel={t('chartType')}
          value={chart.chartType}
          options={TYPES.map((option) => ({ ...option, label: t(`chartTypes.${option.value}`) }))}
          onChange={(value) => onProps([chart.elementId], { chartType: value })}
        />
        {pie ? null : (
          <div className="grid grid-cols-2 gap-2">
            {(['xTitle', 'yTitle'] as const).map((axis) => (
              <label
                key={axis}
                className="flex h-7 items-center gap-1.5 rounded-md bg-muted/60 pl-2 text-xs"
              >
                <span className="shrink-0 text-muted-foreground">{t(axis)}</span>
                <CellInput
                  value={chart[axis]}
                  ariaLabel={t(axis)}
                  onCommit={(text) => {
                    onChartAxes(chart.elementId, { [axis]: text.trim() });
                    return true;
                  }}
                />
              </label>
            ))}
          </div>
        )}
      </Section>
      <Section
        title={t('chartData')}
        actions={
          <>
            <IconButton
              icon={ClipboardPasteIcon}
              label={t('pasteChartData')}
              onClick={() => void pasteClipboard()}
            />
            <IconButton
              icon={MinusSignIcon}
              label={t('removeSeries')}
              disabled={data.series.length <= 1}
              onClick={() => apply(removeSeries(data))}
            />
            <IconButton
              icon={Add01Icon}
              label={t('addSeries')}
              onClick={() => apply(addSeries(data, t('seriesName', { n: data.series.length + 1 })))}
            />
          </>
        }
      >
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full border-separate border-spacing-0.5 text-xs">
            <thead>
              <tr>
                <th className="w-2/5" />
                {data.series.map((series, s) => (
                  <th key={s} className="font-medium">
                    <CellInput
                      value={series.name}
                      ariaLabel={t('seriesLabel', { n: s + 1 })}
                      onPasteRange={pasteAt({ row: 0, column: s + 1 })}
                      onCommit={(text) => {
                        if (text.trim() === '') return false;
                        apply(setSeriesName(data, s, text.trim()));
                        return true;
                      }}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.categories.map((category, c) => (
                <tr key={c}>
                  <td>
                    <CellInput
                      value={category}
                      ariaLabel={t('categoryLabel', { n: c + 1 })}
                      onPasteRange={pasteAt({ row: c + 1, column: 0 })}
                      onCommit={(text) => {
                        if (text.trim() === '') return false;
                        apply(setCategory(data, c, text.trim()));
                        return true;
                      }}
                    />
                  </td>
                  {data.series.map((series, s) => (
                    <td key={s}>
                      <CellInput
                        numeric
                        value={String(series.values[c] ?? 0)}
                        ariaLabel={t('valueLabel', { series: series.name, category })}
                        onPasteRange={pasteAt({ row: c + 1, column: s + 1 })}
                        onCommit={(text) => {
                          const value = parseNumber(text);
                          if (value === null) return false;
                          apply(setValue(data, s, c, value));
                          return true;
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-1">
          <span className="flex-1 text-xs text-muted-foreground">{t('categories')}</span>
          <IconButton
            icon={MinusSignIcon}
            label={t('removeCategory')}
            disabled={data.categories.length <= 1}
            onClick={() => apply(removeCategory(data))}
          />
          <IconButton
            icon={Add01Icon}
            label={t('addCategory')}
            onClick={() => apply(addCategory(data, String(data.categories.length + 1)))}
          />
        </div>
        <p
          role={pasteNote ? 'status' : undefined}
          data-chart-paste-note={pasteNote ?? undefined}
          className={cn('text-xs', pasteNote ? 'text-foreground' : 'text-muted-foreground')}
        >
          {pasteNote === 'empty'
            ? t('pasteChartEmpty')
            : pasteNote === 'denied'
              ? t('pasteChartDenied')
              : t('pasteChartHint')}
        </p>
      </Section>
    </>
  );
}
