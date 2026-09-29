import { describe, expect, it } from 'vitest';
import type { Composition } from '@lct/contracts';
import { type DeckSlide, deckRepeats, figuresOf } from './repeats.js';

const slot = (slotId: string, role: 'title' | 'body', fontSize: number) => ({
  slotId,
  role,
  sample: '',
  maxChars: 120,
  maxLines: 3,
  font: 'Inter',
  fontSize,
});
const cards: Composition = {
  patternId: 'cards',
  sourceIndex: 3,
  name: 'Cards',
  slots: [slot('t', 'title', 32), slot('a', 'body', 14), slot('b', 'body', 14)],
  imageCount: 0,
};
const deck = (slides: readonly (readonly [string, string, string, string])[]): DeckSlide[] =>
  slides.map(([purpose, title, a, b], index) => ({
    index,
    purpose,
    composition: cards,
    slide: {
      patternId: 'cards',
      speakerNotes: '',
      texts: [
        { slotId: 't', text: title },
        { slotId: 'a', text: a },
        { slotId: 'b', text: b },
      ],
    },
  }));

const BRIEF =
  'Пилот 2025: 12 компаний, 18 000 обращений, 42% обработано автоматически, ' +
  'время ответа с 6 до 2 минут, затраты снизились на 24%. Цель 2026 — 60 компаний.';
const DECK_TITLE = 'Пилот «Диалога»: результаты и план 2026';

describe('figuresOf', () => {
  it('keeps percentages and multi-digit numbers, not years or small counts', () => {
    expect([...figuresOf(BRIEF)].sort()).toEqual(['12', '18000', '24%', '42%', '60']);
    expect([...figuresOf(`42 % и 18${String.fromCharCode(160)}000`)].sort()).toEqual([
      '18000',
      '42%',
    ]);
  });
});

describe('deckRepeats', () => {
  it('flags a slide that restates the figures of other slides and the deck title', () => {
    const findings = deckRepeats(
      DECK_TITLE,
      deck([
        ['Обложка', DECK_TITLE, '', ''],
        [
          'Автоматизация — 42% обращений без людей',
          'ИИ закрыл почти половину обращений',
          '42% без оператора',
          'Операторы заняты сложными случаями',
        ],
        [
          'Затраты — снизились на 24%',
          'Поддержка стала дешевле на четверть',
          'Затраты ниже на 24%',
          'Экономия на рутине',
        ],
        [
          'Проблема — ручная обработка медленная',
          'Пилот «Диалога»: итоги и план 2026',
          '42% обращений обработано ИИ',
          'Затраты снизились на 24%',
        ],
        ['Итог', 'Пилот готов к масштабу', '42% и 24%', '60 компаний в 2026'],
      ]),
      BRIEF,
    );
    expect(findings.map((f) => [f.slideIndex, f.slotId])).toEqual([
      [3, 'a'],
      [3, 'b'],
      [3, 't'],
    ]);
    expect(findings[0]?.message).toContain('slide 2');
    expect(findings[2]?.message).toContain('title of the deck');
  });

  it('flags titles that say an earlier title again in other word forms', () => {
    const findings = deckRepeats(
      'Результаты пилота сервиса «Диалог» и план развития на 2026 год',
      deck([
        ['Обложка', 'Результаты пилота сервиса «Диалог»', '', ''],
        ['Проблема', 'Пилот «Диалога»: итоги и план 2026', 'Нагрузка', 'Ручная обработка'],
        ['Решение', 'Пилот «Диалога»: результаты и план 2026', 'Скорость', 'Ответ быстрее'],
        ['Масштаб', 'Пилот «Диалога»: результаты', 'Охват', 'Реальные условия'],
        ['План', 'План развития на 2026 год', 'Подключения', 'Алгоритмы'],
        ['Итог', 'Пилот готов к масштабу', '', ''],
      ]),
      BRIEF,
    );
    expect(findings.map((f) => [f.slideIndex, f.slotId])).toEqual([
      [2, 't'],
      [3, 't'],
    ]);
  });

  it('passes a deck where each figure is told once and titles differ', () => {
    const findings = deckRepeats(
      DECK_TITLE,
      deck([
        ['Обложка', DECK_TITLE, '', ''],
        [
          'Проблема — ручная обработка медленная',
          'Операторы тонут в рутине',
          'Каждое обращение разбирают вручную',
          'Клиенты ждут первого ответа',
        ],
        [
          'Автоматизация — 42% обращений без людей',
          'ИИ закрыл почти половину обращений',
          '42% без оператора',
          'Операторы заняты сложными случаями',
        ],
        [
          'Затраты — снизились на 24%',
          'Поддержка стала дешевле на четверть',
          'Затраты ниже на 24%',
          'Экономия на рутине',
        ],
        ['Итог', 'Пилот готов к масштабу', '42% и 24%', '60 компаний в 2026'],
      ]),
      BRIEF,
    );
    expect(findings).toEqual([]);
  });
});
