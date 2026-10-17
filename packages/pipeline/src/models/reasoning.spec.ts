import { describe, expect, it } from 'vitest';
import { reasoningRequestFields } from './reasoning.js';

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
});
