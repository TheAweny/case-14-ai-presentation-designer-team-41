import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  loadRuntimeAgent,
  readRuntimeLimits,
  runtimeInstructions,
  withRuntimeLimits,
} from './runtime-limits.js';
import type { TextProvider } from './generation/provider.js';

describe('deployment runtime limits', () => {
  it('uses bounded defaults and explicit administrator values', () => {
    expect(readRuntimeLimits({})).toEqual({
      modelConcurrency: 8,
      generationConcurrency: 3,
      generationDeadlineMs: 270_000,
    });
    expect(
      readRuntimeLimits({
        MODEL_MAX_CONCURRENCY: '2',
        GENERATION_CONCURRENCY: '1',
        GENERATION_DEADLINE_MS: '120000',
      }),
    ).toEqual({ modelConcurrency: 2, generationConcurrency: 1, generationDeadlineMs: 120_000 });
  });

  it.each(['0', '-1', '1.5', 'NaN', 'Infinity', '65', '2e1', ' 2'])(
    'rejects invalid provider quota %s',
    (value) => {
      expect(() => readRuntimeLimits({ MODEL_MAX_CONCURRENCY: value })).toThrow(
        'MODEL_MAX_CONCURRENCY',
      );
    },
  );

  it('does not allow an extended generation budget or an unbounded worker pool', () => {
    expect(() => readRuntimeLimits({ GENERATION_DEADLINE_MS: '300000' })).toThrow(
      'GENERATION_DEADLINE_MS',
    );
    expect(() => readRuntimeLimits({ GENERATION_CONCURRENCY: '7' })).toThrow(
      'GENERATION_CONCURRENCY',
    );
  });

  it('refreshes actual time and quotas at dispatch without changing task inputs', async () => {
    const agent = await loadRuntimeAgent(resolve('..', '..', 'registry', 'agents'));
    const calls: { instructions: string; input: unknown }[] = [];
    const provider: TextProvider = {
      model: 'offline',
      async generate(_role, instructions, input, schema) {
        calls.push({ instructions, input });
        return schema.parse('accepted');
      },
    };
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      const context = () => ({
        limits: readRuntimeLimits({}),
        deadlineAt: 5000,
        researchCallsRemaining: 0,
        modelConcurrencyNow: 2,
      });
      const wrapped = withRuntimeLimits(provider, agent, context);
      const input = { brief: 'recorded task' };
      const signal = new AbortController().signal;
      await wrapped.generate('writer', 'registry instructions', input, z.string(), signal);
      now.mockReturnValue(4500);
      await wrapped.generate('rewriter', 'registry repair instructions', input, z.string(), signal);
      expect(calls[0]?.instructions).toContain('"remainingMs":4000');
      expect(calls[1]?.instructions).toContain('"remainingMs":500');
      expect(calls[1]?.instructions).toContain('"researchCallsRemaining":0');
      expect(calls[1]?.instructions).toContain('"modelConcurrencyNow":2');
      expect(calls.every((call) => call.input === input)).toBe(true);
      expect(runtimeInstructions(agent, { ...context(), deadlineAt: 4000 })).toContain(
        '"remainingMs":0',
      );
    } finally {
      now.mockRestore();
    }
  });
});
