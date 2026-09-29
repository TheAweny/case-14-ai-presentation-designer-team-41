import { describe, expect, it } from 'vitest';
import { enabledModelIds, isModelEnabled, modelFamily } from './model-families.js';

describe('modelFamily', () => {
  it.each([
    ['gpt-4o', 'gpt'],
    ['openai/gpt-4o-mini', 'gpt'],
    ['chatgpt-4o-latest', 'gpt'],
    ['o1-mini', 'gpt'],
    ['o3', 'gpt'],
    ['o4-mini', 'gpt'],
    ['claude-3-7-sonnet', 'claude'],
    ['anthropic/claude-sonnet-4', 'claude'],
    ['gemini-2.0-flash', 'gemini'],
    ['gpt://folder/qwen3.6-35b-a3b/latest', 'qwen'],
    ['qwen3:8b', 'qwen'],
    ['meta-llama/Llama-3.1-8B', 'llama'],
    ['llama3.1:8b', 'llama'],
    ['deepseek-chat', 'deepseek'],
    ['mistral-nemo', 'mistral'],
    ['mixtral-8x7b', 'mistral'],
    ['codestral-latest', 'mistral'],
    ['pixtral-12b', 'mistral'],
    ['grok-2', 'grok'],
    ['command-r', 'command'],
    ['phi-3', 'phi'],
    ['gemma2', 'gemma'],
    ['yi-large', 'yi'],
    ['dolphin', 'other'],
    ['yandexgpt', 'other'],
    ['openai/clip-vit-large', 'other'],
    ['', 'other'],
  ] as const)('reads %s as %s', (modelId, family) => {
    expect(modelFamily(modelId)).toBe(family);
  });
});

describe('enabled models', () => {
  const reported = ['gpt-4o', 'qwen3:8b', 'claude-3-7-sonnet'];

  it('keeps every reported model when the connection is not limited', () => {
    expect(enabledModelIds(reported, null)).toEqual(reported);
    expect(isModelEnabled('typed-by-hand', null)).toBe(true);
  });

  it('keeps only the enabled ids, in the order the server reported them', () => {
    expect(enabledModelIds(reported, ['claude-3-7-sonnet', 'gpt-4o', 'missing'])).toEqual([
      'gpt-4o',
      'claude-3-7-sonnet',
    ]);
    expect(enabledModelIds(reported, [])).toEqual([]);
  });

  it('allows only the listed ids once the connection is limited', () => {
    expect(isModelEnabled('qwen3:8b', ['gpt-4o'])).toBe(false);
    expect(isModelEnabled('gpt-4o', ['gpt-4o'])).toBe(true);
    expect(isModelEnabled('typed-by-hand', ['gpt-4o'])).toBe(false);
    expect(isModelEnabled('gpt-4o', [])).toBe(false);
  });
});
