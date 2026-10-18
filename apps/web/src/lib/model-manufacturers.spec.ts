import { describe, expect, it } from 'vitest';
import { modelManufacturer } from './model-manufacturers';

describe('model manufacturer presentation', () => {
  it.each([
    ['glm-5.3-flash', 'zhipu'],
    ['aliceai-llm', 'yandex'],
    ['yandexgpt-5-pro', 'yandex'],
    ['qwen3.8-max-preview', 'alibaba'],
    ['gpt-oss-120b', 'openai'],
    ['openai/qwen3.6-35b-a3b', 'alibaba'],
    ['gpt://folder/qwen3.6/latest', 'alibaba'],
    ['gpt://folder/custom-unknown/latest', 'other'],
    ['https://gpt.example.org/claude', 'other'],
    ['a-custom-model', 'other'],
    ['', 'other'],
  ])('groups %s without using the transport as the company', (id, expected) => {
    expect(modelManufacturer(id)).toBe(expected);
  });
});
