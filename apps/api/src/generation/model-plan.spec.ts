import type { ReasoningEffort } from '@lct/contracts';
import { describe, expect, it } from 'vitest';
import { effectiveModelPlan } from './model-plan.js';

const writer = {
  modelId: 'writer-model',
  connectionId: 'conn-writer',
  apiKey: 'sk-secret-key',
  baseUrl: 'https://secret.example/v1',
  headers: { 'X-Project': 'project-secret' },
};

function planFor(input: {
  readonly writerExplicit: boolean;
  readonly thinking: boolean | null;
  readonly reasoningEffort: ReasoningEffort | null;
  readonly planner: { readonly modelId: string; readonly connectionId: string } | null;
  readonly critic: { readonly modelId: string; readonly connectionId: string } | null;
}) {
  return effectiveModelPlan({
    startedAt: 1_000,
    deadlineAt: 291_000,
    attemptBudgetMax: 110,
    writer,
    vision: null,
    ...input,
  });
}

describe('effective model plan', () => {
  it('records an explicit writer and falls back when planner and critic are unset', () => {
    const plan = planFor({
      writerExplicit: true,
      thinking: null,
      reasoningEffort: null,
      planner: null,
      critic: null,
    });
    expect(plan.roles).toEqual([
      {
        role: 'writer',
        modelId: 'writer-model',
        connectionId: 'conn-writer',
        source: 'explicit-action',
      },
      {
        role: 'rewriter',
        modelId: 'writer-model',
        connectionId: 'conn-writer',
        source: 'writer-fallback',
      },
      {
        role: 'planner',
        modelId: 'writer-model',
        connectionId: 'conn-writer',
        source: 'writer-fallback',
      },
      {
        role: 'critic',
        modelId: 'writer-model',
        connectionId: 'conn-writer',
        source: 'writer-fallback',
      },
    ]);
  });

  it('keeps an assigned planner and critic instead of the writer', () => {
    const plan = planFor({
      writerExplicit: false,
      thinking: null,
      reasoningEffort: null,
      planner: { modelId: 'planner-model', connectionId: 'conn-planner' },
      critic: { modelId: 'critic-model', connectionId: 'conn-critic' },
    });
    expect(plan.roles).toEqual([
      {
        role: 'writer',
        modelId: 'writer-model',
        connectionId: 'conn-writer',
        source: 'role-setting',
      },
      {
        role: 'rewriter',
        modelId: 'writer-model',
        connectionId: 'conn-writer',
        source: 'writer-fallback',
      },
      {
        role: 'planner',
        modelId: 'planner-model',
        connectionId: 'conn-planner',
        source: 'role-setting',
      },
      {
        role: 'critic',
        modelId: 'critic-model',
        connectionId: 'conn-critic',
        source: 'role-setting',
      },
    ]);
  });

  it('omits null request fields and keeps an explicit false', () => {
    const omitted = planFor({
      writerExplicit: true,
      thinking: null,
      reasoningEffort: null,
      planner: null,
      critic: null,
    });
    expect(omitted).not.toHaveProperty('requestedThinking');
    expect(omitted).not.toHaveProperty('requestedReasoningEffort');

    const kept = planFor({
      writerExplicit: true,
      thinking: false,
      reasoningEffort: 'low',
      planner: null,
      critic: null,
    });
    expect(kept.requestedThinking).toBe(false);
    expect(kept.requestedReasoningEffort).toBe('low');
  });

  it('does not copy apiKey, baseUrl, or headers into the plan', () => {
    const input = {
      startedAt: 1_000,
      deadlineAt: 291_000,
      attemptBudgetMax: 110,
      thinking: false,
      reasoningEffort: null,
      writerExplicit: true,
      writer,
      planner: null,
      critic: null,
      vision: null,
      apiKey: writer.apiKey,
      baseUrl: writer.baseUrl,
      headers: writer.headers,
    };
    const plan = effectiveModelPlan(input);
    const json = JSON.stringify(plan);
    expect(json).not.toContain('sk-secret-key');
    expect(json).not.toContain('secret.example');
    expect(json).not.toContain('project-secret');
    expect(json).not.toContain('apiKey');
    expect(json).not.toContain('baseUrl');
    expect(Object.keys(plan)).not.toContain('headers');
  });
});
