import { describe, expect, it } from 'vitest';
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
} from './chart-data';

const data: ChartData = {
  categories: ['2024', '2025'],
  series: [
    { name: 'Выручка', values: [10, 12] },
    { name: 'Расходы', values: [7, 8] },
  ],
};

describe('chart data edits', () => {
  it('changes one label or one value and nothing else', () => {
    expect(setCategory(data, 1, '2026').categories).toEqual(['2024', '2026']);
    expect(setSeriesName(data, 0, 'Доход').series.map((s) => s.name)).toEqual(['Доход', 'Расходы']);
    expect(setValue(data, 1, 0, 9).series[1]?.values).toEqual([9, 8]);
    expect(setValue(data, 1, 0, null).series[1]?.values).toEqual([null, 8]);
    expect(setValue(data, 0, 0, 0).series[0]?.values).toEqual([0, 12]);
    expect(data.series[1]?.values).toEqual([7, 8]);
  });

  it('keeps every series as long as the categories', () => {
    const more = addCategory(data, '2026');
    expect(more.series.map((s) => s.values)).toEqual([
      [10, 12, 0],
      [7, 8, 0],
    ]);
    expect(removeCategory(more)).toEqual(data);
  });

  it('never removes the last category or series', () => {
    const one: ChartData = { categories: ['a'], series: [{ name: 's', values: [1] }] };
    expect(removeCategory(one)).toBe(one);
    expect(removeSeries(one)).toBe(one);
  });

  it('adds a series shaped like the last one', () => {
    expect(addSeries(data, 'План').series.at(-1)).toEqual({ name: 'План', values: [7, 8] });
    expect(sameData(removeSeries(addSeries(data, 'План')), data)).toBe(true);
  });
});
