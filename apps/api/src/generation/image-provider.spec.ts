import { describe, expect, it } from 'vitest';
import { FakeImageProvider, OpenAICompatibleImageProvider } from '@lct/pipeline';
import { imageProviderOf } from './generation.service.js';

describe('imageProviderOf', () => {
  const assigned = { apiKey: 'k', baseUrl: 'https://images.example.test/v1', model: 'flux' };

  it('draws with the model of the image role first', () => {
    const provider = imageProviderOf(assigned, {
      IMAGE_BASE_URL: 'https://other.example.test/v1',
      IMAGE_MODEL: 'other',
    });
    expect(provider).toBeInstanceOf(OpenAICompatibleImageProvider);
    expect(provider?.model).toBe('flux');
  });

  it("falls back on the server's image model only when both its address and name are set", () => {
    expect(imageProviderOf(null, { IMAGE_BASE_URL: 'http://localhost:8082/v1' })).toBeNull();
    expect(
      imageProviderOf(null, { IMAGE_BASE_URL: 'http://localhost:8082/v1', IMAGE_MODEL: 'flux' })
        ?.model,
    ).toBe('flux');
    expect(imageProviderOf(null, {})).toBeNull();
  });

  it('draws offline pictures when asked to fake them', () => {
    expect(imageProviderOf(null, { IMAGE_PROVIDER: 'fake' })).toBeInstanceOf(FakeImageProvider);
  });

  it('draws nothing when pictures are disabled, even with a model configured', () => {
    expect(
      imageProviderOf(null, {
        IMAGE_PROVIDER: 'disabled',
        IMAGE_BASE_URL: 'https://images.example.test/v1',
        IMAGE_MODEL: 'flux',
      }),
    ).toBeNull();
  });
});
