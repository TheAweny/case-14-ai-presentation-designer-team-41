import { describe, expect, it } from 'vitest';
import { reasoningRequestFields, samplingAllowed } from './reasoning.js';

describe('reasoning request policy', () => {
  it.each([
    'Qwen/Qwen3.5-27B',
    'qwen3.5:27b',
    'gpt://folder/qwen3.6-35b-a3b/latest',
    'Qwen/Qwen3-8B',
  ])('enables thinking for %s', (model) => {
    expect(reasoningRequestFields(model)).toEqual({
      chat_template_kwargs: { enable_thinking: true },
    });
  });
  it.each([
    'custom-model',
    'openai/gpt-oss-20b',
    'Qwen/Qwen3-30B-A3B-Instruct-2507',
    'Qwen/Qwen3-VL-8B-Instruct',
    'Qwen/Qwen2.5-32B',
  ])('preserves server defaults for %s', (model) => {
    expect(reasoningRequestFields(model)).toEqual({});
  });

  it('sends reasoning depth only to models that accept it', () => {
    expect(reasoningRequestFields('openai/gpt-oss-20b', 'low')).toEqual({
      reasoning_effort: 'low',
    });
    expect(reasoningRequestFields('Qwen/Qwen3.5-27B', 'high')).toEqual({
      chat_template_kwargs: { enable_thinking: true },
    });
    expect(reasoningRequestFields('gpt-4o', 'high')).toEqual({});
  });

  it('switches hybrid thinking off only when asked', () => {
    expect(reasoningRequestFields('Qwen/Qwen3.5-27B', null, false)).toEqual({
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(reasoningRequestFields('Qwen/Qwen3.5-27B', null, null)).toEqual({
      chat_template_kwargs: { enable_thinking: true },
    });
    expect(reasoningRequestFields('openai/gpt-oss-20b', 'low', false)).toEqual({
      reasoning_effort: 'low',
    });
    expect(reasoningRequestFields('custom-model', null, false)).toEqual({});
  });

  it('lets hybrids think on request and answer at once when switched off', () => {
    expect(reasoningRequestFields('gpt-6.1-sol', 'high', true)).toEqual({
      reasoning_effort: 'high',
    });
    expect(reasoningRequestFields('claude-sonnet-4-5', null, null)).toEqual({
      reasoning_effort: 'medium',
    });
    expect(reasoningRequestFields('claude-sonnet-4-5', 'low', false)).toEqual({});
    expect(reasoningRequestFields('qwen38-27b-fp8', 'high', false)).toEqual({
      chat_template_kwargs: { enable_thinking: false },
    });
  });

  it('drops sampling while a model thinks through reasoning_effort', () => {
    expect(samplingAllowed('gpt-6.1-sol', { reasoning_effort: 'low' })).toBe(false);
    expect(samplingAllowed('gpt-6.1-sol', {})).toBe(true);
    expect(samplingAllowed('o3', {})).toBe(false);
    expect(
      samplingAllowed('qwen38-27b-fp8', { chat_template_kwargs: { enable_thinking: true } }),
    ).toBe(true);
  });
});
