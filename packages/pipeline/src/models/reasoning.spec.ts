import { describe, expect, it } from 'vitest';
import { reasoningRequestFields, samplingAllowed } from './reasoning.js';

describe('reasoning request policy', () => {
  it('switches enable_thinking and thinks unless switched off', () => {
    const qwen = { toggle: 'enable-thinking', levels: false } as const;
    expect(reasoningRequestFields(qwen, 'high', null)).toEqual({
      chat_template_kwargs: { enable_thinking: true },
    });
    expect(reasoningRequestFields(qwen, 'high', false)).toEqual({
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(reasoningRequestFields({ ...qwen, levels: true }, 'low', true)).toEqual({
      chat_template_kwargs: { enable_thinking: true },
      reasoning_effort: 'low',
    });
  });

  it('asks a reasoning_effort model to think at a depth, and to stop with none', () => {
    const hybrid = { toggle: 'reasoning-effort', levels: true } as const;
    expect(reasoningRequestFields(hybrid, 'high', true)).toEqual({ reasoning_effort: 'high' });
    expect(reasoningRequestFields(hybrid, 'low', false)).toEqual({ reasoning_effort: 'none' });
    expect(reasoningRequestFields({ ...hybrid, levels: false }, 'high', null)).toEqual({
      reasoning_effort: 'medium',
    });
  });

  it('sends a depth only where it was shown to change the answer', () => {
    expect(reasoningRequestFields({ toggle: null, levels: true }, 'low')).toEqual({
      reasoning_effort: 'low',
    });
    expect(reasoningRequestFields({ toggle: null, levels: false }, 'low')).toEqual({});
    expect(reasoningRequestFields(undefined, 'high', true)).toEqual({});
  });

  it('drops sampling while a model thinks through reasoning_effort', () => {
    const hybrid = { toggle: 'reasoning-effort', levels: true } as const;
    const qwen = { toggle: 'enable-thinking', levels: true } as const;
    expect(samplingAllowed(hybrid, { reasoning_effort: 'low' })).toBe(false);
    expect(samplingAllowed(hybrid, { reasoning_effort: 'none' })).toBe(false);
    expect(samplingAllowed(qwen, { reasoning_effort: 'low' })).toBe(true);
    expect(samplingAllowed(undefined, {})).toBe(true);
  });
});
