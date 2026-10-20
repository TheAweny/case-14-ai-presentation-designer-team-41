import { describe, expect, it } from 'vitest';
import type { SlideIr } from '@lct/contracts';
import { checkContentCoverage, ContentCoverageError } from './content-coverage.js';

const CLAIM = 'не превышает 10 млн при 80%';

function slide(text: string, extra: Record<string, unknown> = {}) {
  return {
    patternId: 'layout-unfamiliar',
    texts: [{ slotId: 'body', text }],
    speakerNotes: '',
    ...extra,
  };
}

describe('checkContentCoverage', () => {
  it('covers a phrase despite case and whitespace, and keeps the visible evidence', () => {
    const report = checkContentCoverage([CLAIM], slide('  Не   превышает\n10 млн при 80%  '));
    expect(report.status).toBe('covered');
    expect(report.requiredCount).toBe(1);
    expect(report.coveredCount).toBe(1);
    expect(report.sourceFactChecking).toBe(false);
    expect(report.items[0]).toMatchObject({
      index: 0,
      text: CLAIM,
      status: 'covered',
      evidence: 'Не превышает 10 млн при 80%',
      reasons: [],
    });
  });

  it('does not pass when negation, condition or unit is missing', () => {
    const droppedNegation = checkContentCoverage([CLAIM], slide('превышает 10 млн при 80%'));
    const droppedCondition = checkContentCoverage([CLAIM], slide('не превышает 10 млн'));
    const droppedUnit = checkContentCoverage(['10 млн'], slide('лимит 10'));
    expect(droppedNegation.status).toBe('requires-review');
    expect(droppedNegation.items[0]?.reasons).toContain('negation-lost');
    expect(droppedNegation.items[0]?.evidence).toBeUndefined();
    expect(droppedCondition.items[0]?.reasons).toContain('condition-lost');
    expect(droppedUnit.items[0]?.reasons).toContain('unit-lost');
    expect(droppedNegation.sourceFactChecking).toBe(false);
  });

  it('does not treat 25 as part of 1025 and does not accept a paraphrase', () => {
    const boundary = checkContentCoverage(['25'], slide('сеть из 1025 точек'));
    const exact = checkContentCoverage(['25'], slide('группа 25'));
    const paraphrase = checkContentCoverage(['выручка снизилась'], slide('выручка выросла'));
    expect(boundary.items[0]?.status).toBe('requires-review');
    expect(boundary.items[0]?.reasons).toContain('number-boundary');
    expect(exact.status).toBe('covered');
    expect(exact.items[0]?.evidence).toBe('25');
    expect(paraphrase.items[0]?.reasons).toContain('not-found');
  });

  it('keeps a fraction, a sign and a thousands group from standing in for 25', () => {
    for (const actual of ['25.5', '25,5', '-25', '25 000']) {
      const report = checkContentCoverage(['25'], slide(actual));
      expect(report.status).toBe('requires-review');
      expect(report.items[0]?.evidence).toBeUndefined();
      expect(report.items[0]?.reasons).toContain('number-boundary');
    }
    const punctuated = checkContentCoverage(['25'], slide('Группа: 25; принято.'));
    expect(punctuated.status).toBe('covered');
    expect(punctuated.items[0]?.evidence).toBe('25');
    const marked = checkContentCoverage(['i'], slide('İ'));
    for (const item of marked.items) {
      if (item.evidence !== undefined) expect('İ').toContain(item.evidence);
    }
  });

  it('reads table cells and chart labels, but not notes or schema field names', () => {
    const table = checkContentCoverage(
      ['10 млн'],
      slide('показатели', {
        visual: {
          kind: 'table',
          slotId: 'body',
          headers: ['План', 'Факт'],
          rows: [['10 млн', '8 млн']],
        },
        speakerNotes: 'секрет 77 только для докладчика',
      }),
    );
    const chart = checkContentCoverage(
      ['80', 'доля, %'],
      slide('итог', {
        visual: {
          kind: 'chart',
          slotId: 'body',
          chartType: 'pie',
          categories: ['Пилот', 'Контроль'],
          series: [{ name: 'Доля', values: [80, 20] }],
          xTitle: 'Группа',
          yTitle: 'доля, %',
        },
      }),
    );
    const notes = checkContentCoverage(
      ['секрет 77'],
      slide('на слайде этого нет', { speakerNotes: 'секрет 77 только для докладчика' }),
    );
    const field = checkContentCoverage(
      ['pie'],
      slide('итог', {
        visual: {
          kind: 'chart',
          slotId: 'body',
          chartType: 'pie',
          categories: ['Пилот', 'Контроль'],
          series: [{ name: 'Доля', values: [80, 20] }],
          xTitle: 'Группа',
          yTitle: 'доля',
        },
      }),
    );
    expect(table.status).toBe('covered');
    expect(table.items[0]?.evidence).toBe('10 млн');
    expect(chart.status).toBe('covered');
    expect(chart.coveredCount).toBe(2);
    expect(notes.status).toBe('requires-review');
    expect(notes.items[0]?.reasons).toContain('not-found');
    expect(field.status).toBe('requires-review');
  });

  it('keeps a mixed requirement list partial and rejects an empty or huge list', () => {
    const mixed = checkContentCoverage([CLAIM, 'группа 25'], slide('группа 25'));
    expect(mixed.status).toBe('requires-review');
    expect(mixed.requiredCount).toBe(2);
    expect(mixed.coveredCount).toBe(1);
    expect(mixed.items[1]?.status).toBe('covered');
    expect(() => checkContentCoverage([], slide('группа 25'))).toThrow(ContentCoverageError);
    expect(() => checkContentCoverage(['   '], slide('группа 25'))).toThrow(ContentCoverageError);
    expect(() => checkContentCoverage(['x'.repeat(1001)], slide('группа 25'))).toThrow(
      ContentCoverageError,
    );
    expect(() =>
      checkContentCoverage(
        Array.from({ length: 21 }, () => 'пункт'),
        slide('группа 25'),
      ),
    ).toThrow(ContentCoverageError);
    expect(() =>
      checkContentCoverage(
        Array.from({ length: 7 }, () => 'я'.repeat(1000)),
        slide('группа 25'),
      ),
    ).toThrow(ContentCoverageError);
    expect(() => checkContentCoverage([CLAIM], { patternId: 'layout-unfamiliar' })).toThrow(
      ContentCoverageError,
    );
  });
});

function savedSlide(text: string): SlideIr {
  return {
    schemaVersion: 1,
    slideId: 'imported-1',
    variant: 'balanced',
    index: 0,
    patternId: 'arbitrary-template',
    slideCx: 10000000,
    slideCy: 6000000,
    notes: '10 млн only in speaker notes',
    elements: [
      {
        kind: 'text',
        elementId: 'current',
        role: 'body',
        sourceShapeId: null,
        box: { x: 100000, y: 100000, cx: 3000000, cy: 1000000 },
        overflow: null,
        paragraphs: [
          {
            level: 0,
            lineSpacing: null,
            runs: [
              {
                text,
                font: '',
                sizePt: null,
                bold: null,
                italic: null,
                color: '',
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('snapshot content evidence', () => {
  it('uses current runs and excludes notes, data-only chart numbers and off-slide text', () => {
    const actual = savedSlide('Visible current fact');
    expect(checkContentCoverage(['Visible current fact'], actual).status).toBe('covered');
    expect(checkContentCoverage(['10 млн'], actual).status).toBe('requires-review');
    expect(checkContentCoverage(['Previous original fact'], actual).coveredCount).toBe(0);
    const current = actual.elements[0];
    if (!current) throw new Error('Missing current text fixture');
    current.box.x = actual.slideCx + 1;
    expect(checkContentCoverage(['Visible current fact'], actual).coveredCount).toBe(0);
    actual.elements = [
      {
        kind: 'chart',
        elementId: 'chart',
        role: 'chart',
        sourceShapeId: null,
        box: { x: 100000, y: 100000, cx: 3000000, cy: 1000000 },
        chartType: 'bar',
        categories: ['Revenue'],
        series: [{ name: 'Actual', values: [25] }],
        xTitle: '',
        yTitle: '',
      },
    ];
    expect(checkContentCoverage(['Actual'], actual).status).toBe('covered');
    expect(checkContentCoverage(['25'], actual).status).toBe('requires-review');
  });

  it('reads saved table cells and shape text, without joining unrelated fragments', () => {
    const actual = savedSlide('Fact');
    actual.elements.push(
      {
        kind: 'table',
        elementId: 'table',
        role: 'table',
        sourceShapeId: null,
        box: { x: 100000, y: 2000000, cx: 3000000, cy: 1000000 },
        headers: ['Plan'],
        rows: [['10 млн']],
      },
      {
        kind: 'decor',
        elementId: 'shape',
        role: 'decoration',
        sourceShapeId: null,
        box: { x: 100000, y: 4000000, cx: 3000000, cy: 1000000 },
        paragraphs: [
          {
            level: 0,
            lineSpacing: null,
            runs: [
              {
                text: 'Approved shape text',
                font: '',
                sizePt: null,
                bold: null,
                italic: null,
                color: '',
              },
            ],
          },
        ],
      },
    );
    expect(checkContentCoverage(['10 млн', 'Approved shape text'], actual).coveredCount).toBe(2);
    expect(checkContentCoverage(['Fact 10 млн'], actual).status).toBe('requires-review');
  });
});

describe('conservative claim coverage', () => {
  it('does not prove a claim embedded in a denial or an added condition', () => {
    expect(
      checkContentCoverage(['Выручка10'], savedSlide('Не подтверждено, что выручка10')).status,
    ).toBe('requires-review');
    for (const actual of [
      'Не подтверждено, что выручка 10',
      'Не подтверждено, что выручка10',
      'Выручка 10 только при условии запуска пилота',
      'Выручка 10, если пилот будет успешен',
    ]) {
      expect(checkContentCoverage(['Выручка 10'], slide(actual)).status).toBe('requires-review');
      expect(checkContentCoverage(['Выручка 10'], savedSlide(actual)).status).toBe(
        'requires-review',
      );
    }
    for (const actual of [
      'Пилот проводился только при условии согласования',
      'Не доказано, что пилот проводился',
    ]) {
      const report = checkContentCoverage(['Пилот проводился'], savedSlide(actual));
      expect(report.status).toBe('requires-review');
      expect(report.items[0]?.evidence).toBeUndefined();
    }
  });

  it('covers the complete claim with its approved negation and conditions intact', () => {
    for (const claim of [
      'Выручка 10',
      'Пилот проводился',
      'Пилот не проводился',
      'Пилот проводился только при условии согласования',
    ]) {
      expect(checkContentCoverage([claim], savedSlide(claim + '.')).status).toBe('covered');
      expect(checkContentCoverage([claim], slide(claim)).status).toBe('covered');
    }
  });
});
