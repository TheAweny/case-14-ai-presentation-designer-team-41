import { describe, expect, it } from 'vitest';
import { portraitCropTop } from './avatar-image';

describe('portraitCropTop', () => {
  it('keeps a tall photo toward the top so the face stays in the square', () => {
    expect(portraitCropTop(1000, 2000, 1000)).toBe(150);
  });

  it('does not shift a square or a wide photo', () => {
    expect(portraitCropTop(800, 800, 800)).toBe(0);
    expect(portraitCropTop(2000, 1000, 1000)).toBe(0);
  });
});
