import { describe, expect, it } from 'vitest';
import {
  materialExtractRequestSchema,
  materialExtractResponseSchema,
  type MaterialExtractResponse,
} from './material-extraction.js';

const sha = 'ab'.repeat(32);

const textResponse = (): MaterialExtractResponse => ({
  schemaVersion: 1,
  kind: 'text',
  sourceSha256: sha,
  segments: [
    {
      index: 0,
      locator: { page: 1, paragraph: 2, sheet: null, range: null },
      text: 'Абзац',
    },
  ],
  table: null,
  offset: 0,
  nextOffset: 20,
  truncated: true,
  needsOcr: false,
  warnings: [],
});

describe('material extract request', () => {
  it('fills offset and limit when the caller omits them', () => {
    const parsed = materialExtractRequestSchema.parse({
      schemaVersion: 1,
      path: 'uploads/notes.md',
      format: 'text',
    });
    expect(parsed.offset).toBe(0);
    expect(parsed.limit).toBe(20);
  });

  it('accepts an A1 range and a sheet name', () => {
    const parsed = materialExtractRequestSchema.parse({
      schemaVersion: 1,
      path: 'uploads/budget.xlsx',
      format: 'table',
      offset: 100_000,
      limit: 100,
      sheet: 'Q1',
      range: 'A1:B100',
    });
    expect(parsed.range).toBe('A1:B100');
  });

  it('rejects a range that is not A1:B100', () => {
    expect(
      materialExtractRequestSchema.safeParse({
        schemaVersion: 1,
        path: 'uploads/budget.xlsx',
        format: 'table',
        range: 'A1',
      }).success,
    ).toBe(false);
  });

  it('rejects an offset or limit outside the window', () => {
    const base = { schemaVersion: 1, path: 'uploads/notes.md', format: 'text' as const };
    expect(materialExtractRequestSchema.safeParse({ ...base, offset: -1 }).success).toBe(false);
    expect(materialExtractRequestSchema.safeParse({ ...base, offset: 100_001 }).success).toBe(
      false,
    );
    expect(materialExtractRequestSchema.safeParse({ ...base, limit: 0 }).success).toBe(false);
    expect(materialExtractRequestSchema.safeParse({ ...base, limit: 101 }).success).toBe(false);
  });

  it('rejects an empty path and a sheet name past 200 characters', () => {
    const base = { schemaVersion: 1, path: 'uploads/notes.md', format: 'text' as const };
    expect(materialExtractRequestSchema.safeParse({ ...base, path: '' }).success).toBe(false);
    expect(
      materialExtractRequestSchema.safeParse({ ...base, sheet: 'я'.repeat(201) }).success,
    ).toBe(false);
  });
});

describe('material extract response', () => {
  it('accepts a text slice and a table page', () => {
    expect(materialExtractResponseSchema.safeParse(textResponse()).success).toBe(true);
    const table = textResponse();
    table.kind = 'table';
    table.segments = [];
    table.table = {
      sheet: 'Q1',
      range: 'A1:B2',
      cells: [
        {
          address: 'A1',
          row: 1,
          column: 1,
          value: 1.5,
          formula: null,
          cached: false,
        },
        {
          address: 'B2',
          row: 2,
          column: 2,
          value: null,
          formula: '=A1',
          cached: true,
        },
      ],
      mergedRanges: ['A1:B2'],
    };
    table.nextOffset = null;
    table.truncated = false;
    expect(materialExtractResponseSchema.safeParse(table).success).toBe(true);
  });

  it('rejects a digest that is not 64 hex characters', () => {
    const payload = textResponse();
    payload.sourceSha256 = 'ab'.repeat(31);
    expect(materialExtractResponseSchema.safeParse(payload).success).toBe(false);
  });

  it('caps segments, cells, warnings and the two string lengths', () => {
    const tooManySegments = textResponse();
    tooManySegments.segments = Array.from({ length: 101 }, (_, index) => ({
      index,
      locator: { page: 1, paragraph: 1, sheet: null, range: null },
      text: '',
    }));
    expect(materialExtractResponseSchema.safeParse(tooManySegments).success).toBe(false);

    const longText = textResponse();
    const segment = longText.segments[0];
    if (segment === undefined) {
      throw new Error('fixture segment missing');
    }
    segment.text = 'а'.repeat(12_001);
    expect(materialExtractResponseSchema.safeParse(longText).success).toBe(false);

    const longWarning = textResponse();
    longWarning.warnings = ['а'.repeat(4_001)];
    expect(materialExtractResponseSchema.safeParse(longWarning).success).toBe(false);

    const tooManyWarnings = textResponse();
    tooManyWarnings.warnings = Array.from({ length: 21 }, () => 'note');
    expect(materialExtractResponseSchema.safeParse(tooManyWarnings).success).toBe(false);

    const table = textResponse();
    table.table = {
      sheet: 'Q1',
      range: 'A1:B2',
      cells: Array.from({ length: 201 }, (_, index) => ({
        address: 'A1',
        row: index + 1,
        column: 1,
        value: 'x'.repeat(4_001),
        formula: null,
        cached: false,
      })),
      mergedRanges: [],
    };
    expect(materialExtractResponseSchema.safeParse(table).success).toBe(false);
  });

  it('rejects a non-finite cell value and a zero page', () => {
    const table = textResponse();
    table.table = {
      sheet: 'Q1',
      range: 'A1:A1',
      cells: [
        {
          address: 'A1',
          row: 1,
          column: 1,
          value: Number.POSITIVE_INFINITY,
          formula: null,
          cached: false,
        },
      ],
      mergedRanges: [],
    };
    expect(materialExtractResponseSchema.safeParse(table).success).toBe(false);

    const page = textResponse();
    const located = page.segments[0];
    if (located === undefined) {
      throw new Error('fixture segment missing');
    }
    located.locator.page = 0;
    expect(materialExtractResponseSchema.safeParse(page).success).toBe(false);
  });
});
