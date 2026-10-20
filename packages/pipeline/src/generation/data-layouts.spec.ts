import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generationProfileSchema } from '@lct/contracts';
import { withDataLayouts } from './workflow.js';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../contracts/fixtures/GenerationProfile.json', import.meta.url),
    'utf8',
  ),
) as { valid: { payload: unknown }[] };
const profile = generationProfileSchema.parse(fixture.valid[0]?.payload);
const base = profile.compositions[0];
const title = base?.slots[0];
if (!base || !title) throw new Error('fixture');
const body = (slotId: string, sample: string, maxChars: number, maxLines: number) => ({
  ...title,
  slotId,
  role: 'body' as const,
  sample,
  maxChars,
  maxLines,
});
const statement = { ...base, patternId: 'statement', slots: [title, body('3', 'Тезис', 244, 4)] };
const chart = { ...base, patternId: 'chart', slots: [title, body('3', 'График', 750, 18)] };
const kpi = {
  ...base,
  patternId: 'kpi',
  slots: [
    title,
    body('3', '42%', 7, 1),
    body('4', '3×', 7, 1),
    body('5', '120', 7, 1),
    body('6', 'что выросло', 110, 5),
  ],
};
const catalog = [statement, chart, kpi];
const brief = '- cloud_cover, среднее: 0 — 43,33, 1 — 30,83.';
const slide = (purpose: string, patternId = 'statement') => ({ patternId, purpose });

describe('data layouts after planning', () => {
  it('moves a slide quoting a series to a chart layout and a slide of figures to the KPI one', () => {
    const slides = [
      slide('Обложка'),
      slide('Облачность решает — cloud_cover, среднее: 0 — 43,33, 1 — 30,83'),
      slide('Три цифры, которые решают: 80% успешных; 3 тестовые ночи; 6 неудачных (20%)'),
      slide(
        'Три цифры — 80% успешных (24/30); облачность при неудачах 43,33; при успехах 30,83',
        'chart',
      ),
      slide('Итог'),
    ];
    expect(withDataLayouts(slides, catalog, brief).map((s) => s.patternId)).toEqual([
      'statement',
      'chart',
      'kpi',
      'kpi',
      'statement',
    ]);
  });

  it('keeps ordinary slides, the cover and the closing slide where the planner put them', () => {
    const slides = [
      slide('cloud_cover, среднее: 0 — 43,33, 1 — 30,83'),
      slide('Облачность мешает — наблюдать в ясные ночи; планировать по погоде'),
      slide('Цифры в чарте — cloud_cover, среднее: 0 — 43,33, 1 — 30,83', 'chart'),
      slide('cloud_cover, среднее: 0 — 43,33, 1 — 30,83'),
    ];
    expect(withDataLayouts(slides, catalog, brief).map((s) => s.patternId)).toEqual([
      'statement',
      'statement',
      'chart',
      'statement',
    ]);
  });
});
