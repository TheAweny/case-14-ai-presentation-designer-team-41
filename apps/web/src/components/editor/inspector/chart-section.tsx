'use client';

import type { KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  Add01Icon,
  ChartAreaIcon,
  ChartColumnIcon,
  ChartLineData01Icon,
  BarChartHorizontalIcon,
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
 * `key` с текущим значением пересоздаёт поле, когда данные поменяла отмена.
 */
function CellInput({
  value,
  ariaLabel,
  numeric,
  onCommit,
}: {
  value: string;
  ariaLabel: string;
  numeric?: boolean;
  onCommit: (text: string) => boolean;
}) {
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
      </Section>
    </>
  );
}
