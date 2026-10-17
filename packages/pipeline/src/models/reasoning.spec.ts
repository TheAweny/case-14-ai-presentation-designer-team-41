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
  it.each(['qwen38', 'qwen3.8', 'Qwen3.8', 'qwen38-27b-fp8', 'Qwen/Qwen3.8-27B'])(
    'forces thinking off for %s and does not send reasoning_effort',
    (model) => {
      expect(reasoningRequestFields(model)).toEqual({
        chat_template_kwargs: { enable_thinking: false },
      });
      expect(reasoningRequestFields(model, 'high')).toEqual({
        chat_template_kwargs: { enable_thinking: false },
      });
    },
  );

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
  it('keeps thinking on for Qwen3-30B-A3B-Thinking-2507 even when options.thinking is false', () => {
    expect(
      reasoningRequestFields('Qwen/Qwen3-30B-A3B-Thinking-2507', undefined, { thinking: false }),
    ).toEqual({
      chat_template_kwargs: { enable_thinking: true },
    });
    expect(
      reasoningRequestFields('gpt://folder/Qwen3-30B-A3B-Thinking-2507/latest', 'high', {
        thinking: false,
      }),
    ).toEqual({
      chat_template_kwargs: { enable_thinking: true },
    });
  });
  it.each(['Qwen/Qwen3-8B', 'gpt://folder/qwen3.6-35b-a3b/latest'])(
    'sets hybrid %s thinking from the third argument, defaulting to true',
    (model) => {
      expect(reasoningRequestFields(model, undefined, { thinking: false })).toEqual({
        chat_template_kwargs: { enable_thinking: false },
      });
      expect(reasoningRequestFields(model)).toEqual({
        chat_template_kwargs: { enable_thinking: true },
      });
    },
  );

  it('keeps Qwen3.8 off, GPT effort, and unknown names when the third argument is set', () => {
    expect(reasoningRequestFields('qwen38-27b-fp8', undefined, { thinking: true })).toEqual({
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(reasoningRequestFields('gpt-5', 'low', { thinking: false })).toEqual({
      reasoning_effort: 'low',
    });
    expect(reasoningRequestFields('custom-model', undefined, { thinking: false })).toEqual({});
  });
});
