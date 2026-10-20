import { describe, expect, it } from 'vitest';
import { compositionPlanSchema } from '@lct/contracts';
import { briefPoints, fallbackPlan } from './fallback-plan.js';

const brief = [
  '# Масштабирование чат-бота',
  '',
  '- Бот закрывает 82% обращений без оператора',
  '- Среднее время ответа 40 секунд',
  '- Пилот стоил 12 млн рублей',
  '- Обращений стало 55 тыс. в сентябре',
  '',
  'Цель: решение правления о запуске в 8 регионах.',
].join('\n');

const catalog = [
  { patternId: 'cover', blocks: 1, kind: 'cover' },
  { patternId: 'one', blocks: 1 },
  { patternId: 'two', blocks: 2 },
  { patternId: 'three', blocks: 3 },
];

describe('a plan made from the brief without a model', () => {
  it('opens on the cover, spreads the points in order and closes on the goal', () => {
    const plan = compositionPlanSchema.parse(
      fallbackPlan({ brief, slideCount: 5, catalog, coverPatternIds: ['cover'] }),
    );
    expect(plan.title).toBe('Масштабирование чат-бота');
    expect(plan.slides).toHaveLength(5);
    expect(plan.slides[0]?.patternId).toBe('cover');
    expect(plan.slides.at(-1)?.purpose).toContain('Цель: решение правления');
    const middle = plan.slides.slice(1, -1).flatMap((slide) => slide.requiredClaims);
    expect(middle.map((claim) => claim.text)).toEqual([
      'Бот закрывает 82% обращений без оператора',
      'Среднее время ответа 40 секунд',
      'Пилот стоил 12 млн рублей',
      'Обращений стало 55 тыс. в сентябре',
    ]);
    // Every claim quotes the brief verbatim, as a planned claim must.
    for (const slide of plan.slides)
      for (const claim of slide.requiredClaims) expect(brief).toContain(claim.source.quote);
  });

  it('picks a layout by the number of points and never the cover in the middle', () => {
    const plan = fallbackPlan({ brief, slideCount: 3 + 2, catalog, coverPatternIds: ['cover'] });
    expect(plan.slides.slice(1).every((slide) => slide.patternId !== 'cover')).toBe(true);
    const wide = fallbackPlan({ brief, slideCount: 5, catalog, coverPatternIds: ['cover'] });
    expect(wide.slides.slice(1, -1).map((slide) => slide.patternId)).toContain('two');
  });

  it('takes the slide count of the brief when none is asked, at least five', () => {
    expect(
      fallbackPlan({ brief, slideCount: null, catalog, coverPatternIds: [] }).slides,
    ).toHaveLength(7);
    expect(
      fallbackPlan({ brief: 'Одна строка', slideCount: null, catalog, coverPatternIds: [] }).slides,
    ).toHaveLength(5);
  });

  it('reads headings and list markers off the lines', () => {
    expect(briefPoints('## Итоги\n1. Первое\n* Второе\n---')).toEqual({
      heading: 'Итоги',
      points: ['Первое', 'Второе'],
    });
  });
});
