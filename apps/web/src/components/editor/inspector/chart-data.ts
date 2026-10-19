/** Данные графика так, как их правит панель: подписи категорий и ряды значений по ним. */
export interface ChartData {
  readonly categories: readonly string[];
  readonly series: readonly {
    readonly name: string;
    readonly values: readonly (number | null)[];
    readonly unit?: string;
  }[];
}

export function setCategory(data: ChartData, index: number, name: string): ChartData {
  return { ...data, categories: data.categories.map((item, i) => (i === index ? name : item)) };
}

export function setSeriesName(data: ChartData, index: number, name: string): ChartData {
  return {
    ...data,
    series: data.series.map((item, i) => (i === index ? { ...item, name } : item)),
  };
}

export function setValue(
  data: ChartData,
  seriesIndex: number,
  categoryIndex: number,
  value: number | null,
): ChartData {
  return {
    ...data,
    series: data.series.map((item, i) =>
      i === seriesIndex
        ? {
            ...item,
            values: item.values.map((v, j) => (j === categoryIndex ? value : v)),
          }
        : item,
    ),
  };
}

/** Новая категория в конец: у каждого ряда появляется значение 0. */
export function addCategory(data: ChartData, name: string): ChartData {
  return {
    categories: [...data.categories, name],
    series: data.series.map((item) => ({ ...item, values: [...item.values, 0] })),
  };
}

/** Последняя категория уходит вместе со своими значениями. Одна остаётся всегда. */
export function removeCategory(data: ChartData): ChartData {
  if (data.categories.length <= 1) return data;
  return {
    categories: data.categories.slice(0, -1),
    series: data.series.map((item) => ({ ...item, values: item.values.slice(0, -1) })),
  };
}

/** Новый ряд — копия последнего по значениям: с ним сразу видно, куда он встал. */
export function addSeries(data: ChartData, name: string): ChartData {
  const last = data.series.at(-1);
  const values = last ? [...last.values] : data.categories.map(() => 0);
  return { ...data, series: [...data.series, { name, values }] };
}

export function removeSeries(data: ChartData): ChartData {
  if (data.series.length <= 1) return data;
  return { ...data, series: data.series.slice(0, -1) };
}

export function sameData(a: ChartData, b: ChartData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
