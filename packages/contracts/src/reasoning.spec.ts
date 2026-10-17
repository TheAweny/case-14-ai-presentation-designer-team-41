import { describe, expect, it } from 'vitest';
import { reasoningControl } from './reasoning.js';

describe('reasoningControl', () => {
  it.each(['openai/gpt-oss-20b', 'gpt-5', 'o1-mini', 'o3', 'o4-mini'])(
    'offers a depth slider for %s',
    (modelId) => {
      expect(reasoningControl(modelId)).toBe('effort');
    },
  );

  it.each(['Qwen/Qwen3.5-27B', 'qwen3.5:27b', 'gpt://folder/qwen3.6-35b-a3b/latest'])(
    'marks %s as thinking without a slider',
    (modelId) => {
      expect(reasoningControl(modelId)).toBe('thinking');
    },
  );

  it.each([
    'gpt-4o',
    'openai/gpt-4o-mini',
    'custom-model',
    'Qwen/Qwen3-30B-A3B-Instruct-2507',
    'Qwen/Qwen3-VL-8B-Instruct',
    'Qwen/Qwen2.5-32B',
  ])('leaves %s alone', (modelId) => {
    expect(reasoningControl(modelId)).toBe('none');
  });
});
