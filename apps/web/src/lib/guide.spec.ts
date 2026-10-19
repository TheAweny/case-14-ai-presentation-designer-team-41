import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_SLUGS,
  GUIDE_SLUGS,
  isArticleSlug,
  isDocsReferenceSlug,
  isGuideSlug,
} from './docs-nav';
import { readGuide } from './guide';

describe('guide articles', () => {
  it('rejects a slug that is not an article', () => {
    expect(isGuideSlug('pipeline')).toBe(true);
    expect(isGuideSlug('variants')).toBe(false);
    expect(isArticleSlug('variants')).toBe(true);
    expect(isArticleSlug('pipeline')).toBe(true);
    expect(isGuideSlug('pipeline.md')).toBe(false);
    expect(isArticleSlug('../openapi')).toBe(false);
    expect(isDocsReferenceSlug('schemas')).toBe(true);
    expect(isDocsReferenceSlug('generation')).toBe(true);
    expect(isDocsReferenceSlug('../generation')).toBe(false);
  });

  it('reads each article', () => {
    for (const slug of [...CAPABILITY_SLUGS, ...GUIDE_SLUGS]) {
      const text = readGuide(slug);
      expect(text.trim().length).toBeGreaterThan(80);
      expect(text).not.toMatch(/TODO|XXX|lorem ipsum/i);
    }
  });

  it('keeps the pipeline densities, the five decisions and the access headers', () => {
    const pipeline = readGuide('pipeline');
    expect(pipeline).toContain('dense');
    expect(pipeline).toContain('balanced');
    expect(pipeline).toContain('airy');
    expect(readGuide('decisions').match(/^## /gm)).toHaveLength(5);
    const access = readGuide('access');
    expect(access).toContain('x-lct-service-token');
    expect(access).toContain('x-lct-user');
    expect(readGuide('variants')).toContain('balanced');
    expect(readGuide('assistant')).toContain('Ctrl+Z');
    expect(readGuide('editing')).toContain('.pptx');
    expect(readGuide('library')).toContain('превью');
  });
});
