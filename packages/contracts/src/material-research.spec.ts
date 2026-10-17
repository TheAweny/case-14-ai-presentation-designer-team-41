import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  materialResearchInputSchema,
  materialResearchAnswerSchema,
  materialResearchResultSchema,
} from './material-research.js';

const id = '00000000-0000-4000-8000-000000000001';
describe('material research contracts', () => {
  it('accepts a bounded question and attached file ids, refusing empty or excessive requests', () => {
    expect(
      materialResearchInputSchema.parse({ question: '  Бюджет?  ', fileIds: [id] }).question,
    ).toBe('Бюджет?');
    expect(materialResearchInputSchema.safeParse({ question: ' ', fileIds: [id] }).success).toBe(
      false,
    );
    expect(
      materialResearchInputSchema.safeParse({ question: 'Бюджет?', fileIds: [] }).success,
    ).toBe(false);
    expect(
      materialResearchInputSchema.safeParse({ question: 'Бюджет?', fileIds: [id, id, id, id] })
        .success,
    ).toBe(false);
  });

  it('caps the model excerpts and strips unsolicited prose from structured answers', () => {
    const excerpt = { sourceId: id, quote: 'Точная цитата.' };
    expect(
      materialResearchAnswerSchema.parse({
        excerpts: [excerpt],
        openQuestions: [],
        summary: 'extra claim',
      }),
    ).toEqual({ excerpts: [excerpt], openQuestions: [] });
    expect(
      materialResearchAnswerSchema.safeParse({
        excerpts: [excerpt, excerpt, excerpt, excerpt],
        openQuestions: [],
      }).success,
    ).toBe(false);
    expect(
      materialResearchAnswerSchema.safeParse({
        excerpts: [{ ...excerpt, quote: 'я'.repeat(1001) }],
        openQuestions: [],
      }).success,
    ).toBe(false);
  });

  it('never accepts grounded support for a matched excerpt', () => {
    const result = {
      outputTruncated: false,
      summary: 'Цитата',
      evidence: [
        { sourceId: id, name: 'brief.txt', quote: 'Цитата', start: 0, support: 'unverified' },
      ],
      coverage: [{ sourceId: id, readChars: 6, truncated: false }],
      openQuestions: [],
      manifest: {
        agentId: 'material-researcher',
        agentVersion: '0.1.0',
        instructionsSha256: 'a'.repeat(64),
        model: 'recorded',
        modelRevision: null,
        seed: null,
        inputTokens: 0,
        outputTokens: 0,
      },
    };
    expect(materialResearchResultSchema.safeParse(result).success).toBe(true);
    expect(
      materialResearchResultSchema.safeParse({
        ...result,
        evidence: [{ ...result.evidence[0], support: 'grounded' }],
      }).success,
    ).toBe(false);
  });

  it('accepts an offset only for a selected file id', () => {
    expect(
      materialResearchInputSchema.parse({
        question: 'Бюджет?',
        fileIds: [id],
        offsets: { [id]: 1_000_000 },
      }).offsets,
    ).toEqual({ [id]: 1_000_000 });
  });

  it('rejects an unknown, negative, fractional, oversized, or non-uuid offset', () => {
    const other = '00000000-0000-4000-8000-000000000002';
    for (const offsets of [
      { [other]: 0 },
      { [id]: -1 },
      { [id]: 1.5 },
      { [id]: 1_000_001 },
      { 'not-a-uuid': 0 },
    ]) {
      expect(
        materialResearchInputSchema.safeParse({ question: 'Бюджет?', fileIds: [id], offsets })
          .success,
      ).toBe(false);
    }
  });

  it('exports the input schema to JSON Schema', () => {
    expect(() => z.toJSONSchema(materialResearchInputSchema, { io: 'input' })).not.toThrow();
  });
});
