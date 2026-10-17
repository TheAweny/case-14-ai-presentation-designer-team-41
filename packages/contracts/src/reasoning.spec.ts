import { describe, expect, it } from 'vitest';
import { canSwitchThinking, reasoningControl } from './reasoning.js';

describe('reasoningControl', () => {
  it.each([
    'openai/gpt-oss-20b',
    'gpt-5',
    'openai/gpt-5-mini',
    'o1-mini',
    'o3',
    'o4-mini',
    'gemini-2.5-pro',
    'google/gemini-3-pro-preview',
    'grok-3-mini',
  ])('offers a depth slider for %s', (modelId) => {
    expect(reasoningControl(modelId)).toBe('effort');
  });

  it.each([
    'gpt-5.1',
    'openai/gpt-5.2-chat',
    'gpt-6.1-sol',
    'openai/gpt-6',
    'claude-3-7-sonnet-20250219',
    'claude-sonnet-4-5-20250929',
    'anthropic/claude-opus-4.1',
    'claude-haiku-4-5',
    'gemini-2.5-flash',
  ])('offers the switch and a depth for %s', (modelId) => {
    expect(reasoningControl(modelId)).toBe('hybrid');
  });

  it.each([
    'Qwen/Qwen3.5-27B',
    'qwen3.5:27b',
    'gpt://folder/qwen3.6-35b-a3b/latest',
    'qwen38-27b-fp8',
    'qwen/qwen3-235b-a22b',
  ])('marks %s as thinking without a slider', (modelId) => {
    expect(reasoningControl(modelId)).toBe('thinking');
  });

  it.each([
    'gpt-4o',
    'openai/gpt-4o-mini',
    'gpt-4.1',
    'custom-model',
    'claude-3-5-sonnet-20241022',
    'claude-3-haiku-20240307',
    'gemini-2.0-flash',
    'Qwen/Qwen3-30B-A3B-Instruct-2507',
    'Qwen/Qwen3-235B-A22B-Thinking-2507',
    'Qwen/Qwen3-VL-8B-Instruct',
    'qwen3-coder-480b',
    'Qwen/Qwen2.5-32B',
    'whisper-1',
  ])('leaves %s alone', (modelId) => {
    expect(reasoningControl(modelId)).toBe('none');
  });

  it('offers the switch only where both answers exist', () => {
    expect(canSwitchThinking('thinking')).toBe(true);
    expect(canSwitchThinking('hybrid')).toBe(true);
    expect(canSwitchThinking('effort')).toBe(false);
    expect(canSwitchThinking('none')).toBe(false);
  });
});
