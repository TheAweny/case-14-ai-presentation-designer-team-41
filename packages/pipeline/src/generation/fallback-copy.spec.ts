import { describe, expect, it } from 'vitest';
import { clip, fallbackTexts } from './fallback-copy.js';

describe('copy taken from the plan when no writer answered', () => {
  it('puts the title in the headline and one claim in each box, the rest in the last', () => {
    const texts = fallbackTexts(
      [
        { slotId: 't', role: 'title', fitChars: 40 },
        { slotId: 'a', role: 'body', fitChars: 60 },
        { slotId: 'b', role: 'body', fitChars: 60 },
      ],
      {
        purpose: 'Show the pilot results. Then ask for the decision.',
        claims: ['Bot closes 82% of requests', 'Answer time is 40 s', 'Pilot cost 12 mln'],
      },
    );
    expect(texts).toEqual({
      t: 'Show the pilot results.',
      a: 'Bot closes 82% of requests',
      b: 'Answer time is 40 s\nPilot cost 12 mln',
    });
  });

  it('uses the purpose when there are fewer claims than boxes and leaves the rest empty', () => {
    const texts = fallbackTexts(
      [
        { slotId: 'a', role: 'body', fitChars: 100 },
        { slotId: 'b', role: 'body', fitChars: 100 },
        { slotId: 'c', role: 'body', fitChars: 100 },
      ],
      { slideTitle: 'Ignored without a title box', purpose: 'Scale to 8 regions', claims: [] },
    );
    expect(texts).toEqual({ a: 'Scale to 8 regions', b: '', c: '' });
  });

  it('cuts at a clause, then at a word, never mid-word and without an ellipsis', () => {
    expect(clip('Облачность решает исход — при 43% наблюдение срывается', 30)).toBe(
      'Облачность решает исход',
    );
    expect(clip('Обращений в поддержку стало заметно больше', 20)).toBe('Обращений в');
    expect(clip('short', 20)).toBe('short');
    expect(clip('Обращений в поддержку', 20)).not.toContain('…');
  });

  it('leaves a narrow box empty rather than tear a word', () => {
    expect(clip('Аудитория обсерватории', 40, { fontSize: 20, textWidthPt: 60 })).toBe('');
  });

  it('prefers a claim that fits whole over one that must be cut', () => {
    const texts = fallbackTexts([{ slotId: 'a', role: 'body', fitChars: 30 }], {
      purpose: '',
      claims: [
        'Очень длинное утверждение, которое в карточку не помещается целиком',
        'Короткий вывод',
      ],
    });
    expect(texts.a?.split('\n')[0]).toBe('Короткий вывод');
  });

  it('bounds the total copy in the last box, including separators', () => {
    const texts = fallbackTexts([{ slotId: 'a', role: 'body', fitChars: 30 }], {
      purpose: '',
      claims: ['Pilot saves 12 mln', 'Answer time is 40 s', 'Satisfaction is 82%'],
    });
    expect(texts.a).toBe('Pilot saves 12 mln');
    expect(texts.a?.length).toBeLessThanOrEqual(30);
  });

  it('does not strip a condition from a claim that cannot fit whole', () => {
    const texts = fallbackTexts([{ slotId: 'a', role: 'body', fitChars: 30 }], {
      purpose: '',
      claims: ['Pilot saves 12 mln only if 8 regions participate', 'Answer time is 40 s'],
    });
    expect(texts.a).toBe('Answer time is 40 s');
    expect(texts.a).not.toContain('Pilot saves 12 mln');
  });
});
