import type { AuditFinding } from '@lct/contracts';
import { describe, expect, it } from 'vitest';
import { contextualCorrections, needsAttention, slideIndexOf } from './self-check.js';

function finding(over: {
  checkId?: string;
  slideId?: string;
  severity?: AuditFinding['severity'];
  confidence?: number;
  quote?: string;
  detail?: string;
  origin?: AuditFinding['origin'];
}): AuditFinding {
  return {
    schemaVersion: 1,
    findingId: `f:${over.checkId ?? 'no-typos'}:${over.slideId ?? 'imported-2'}`,
    checkId: over.checkId ?? 'no-typos',
    origin: over.origin ?? 'contextual',
    severity: over.severity ?? 'major',
    confidence: over.confidence ?? 0.9,
    title: 'Не выполнено: текст без опечаток',
    detail: over.detail ?? 'Исправить написание',
    target: {
      slideId: over.slideId ?? 'imported-2',
      variant: 'balanced',
      elementId: null,
      box: null,
    },
    evidence: {
      measured: '',
      expected: 'В тексте нет опечаток?',
      quote: over.quote ?? 'Рост продаж на 12 процентов',
      sources: [],
      screenshot: '',
    },
    fixability: 'assisted',
    proposedPatch: null,
  };
}

const written = [
  { index: 0, slide: { texts: [{ slotId: 'a', text: 'Первый слайд' }] } },
  {
    index: 1,
    slide: {
      texts: [
        { slotId: 'title', text: 'Итоги квартала' },
        { slotId: 'body', text: 'Рост  продаж на 12 процентов\nпо сравнению с годом ранее' },
      ],
    },
  },
];

describe('slideIndexOf', () => {
  it('reads the number a slide id ends with, for the plan and for a deck read back', () => {
    expect(slideIndexOf('s3')).toBe(2);
    expect(slideIndexOf('imported-1')).toBe(0);
    expect(slideIndexOf('cover')).toBeNull();
  });
});

describe('contextualCorrections', () => {
  it('sends the slot a sure finding quotes to the rewriter, with what was wrong', () => {
    const [correction, ...rest] = contextualCorrections([finding({})], written);
    expect(rest).toEqual([]);
    expect(correction).toMatchObject({ index: 1, slotId: 'body' });
    expect(correction?.message).toContain('Рост продаж на 12 процентов');
    expect(correction?.message).toContain('Подсказка: Исправить написание');
  });

  it('leaves out what it cannot place or cannot trust', () => {
    const skipped = [
      finding({ confidence: 0.6 }),
      finding({ severity: 'info' }),
      finding({ checkId: 'duplicate-message' }),
      finding({ origin: 'deterministic' }),
      finding({ quote: 'год' }),
      finding({ quote: 'Такого текста на слайде нет' }),
      finding({ slideId: 'imported-9' }),
    ];
    expect(contextualCorrections(skipped, written)).toEqual([]);
  });

  it('does not guess between two slots that both hold the quote', () => {
    const twice = [
      {
        index: 1,
        slide: {
          texts: [
            { slotId: 'a', text: 'Рост продаж на 12 процентов' },
            { slotId: 'b', text: 'Снова: рост продаж на 12 процентов' },
          ],
        },
      },
    ];
    expect(contextualCorrections([finding({})], twice)).toEqual([]);
  });

  it('asks about a slot once and about three slots of a slide at most', () => {
    const crowded = [
      {
        index: 1,
        slide: {
          texts: ['alpha text', 'bravo text', 'charlie text', 'delta text'].map((text, i) => ({
            slotId: `s${i}`,
            text,
          })),
        },
      },
    ];
    const findings = [
      finding({ quote: 'alpha text' }),
      finding({ quote: 'alpha text', checkId: 'no-service-text' }),
      finding({ quote: 'bravo text' }),
      finding({ quote: 'charlie text' }),
      finding({ quote: 'delta text' }),
    ];
    const found = contextualCorrections(findings, crowded);
    expect(found.map((c) => c.slotId)).toEqual(['s0', 's1', 's2']);
  });
});

describe('needsAttention', () => {
  it('keeps the blockers and majors', () => {
    const list = [finding({ severity: 'minor' }), finding({ severity: 'major' })];
    expect(needsAttention(list)).toHaveLength(1);
  });
});
