import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SlideIr } from '@lct/contracts';
import {
  type DecodableImage,
  type FontLoader,
  decodeImages,
  loadFonts,
  settleWithin,
  slideImageUrls,
} from './asset-readiness';

function image(elementId: string, mediaPart: string): SlideIr['elements'][number] {
  return {
    kind: 'image',
    elementId,
    role: 'image',
    box: { x: 0, y: 0, cx: 100, cy: 100 },
    sourceShapeId: null,
    mediaPart,
    fit: 'contain',
  };
}

describe('settleWithin', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('выполняется, когда задача отклонена', async () => {
    await expect(settleWithin(Promise.reject(new Error('404')), 1000)).resolves.toBeUndefined();
  });

  it('выполняется по истечении времени, не дожидаясь задачи', async () => {
    vi.useFakeTimers();
    let settled = false;
    void settleWithin(new Promise(() => undefined), 1000).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });
});

describe('loadFonts', () => {
  it('просит у браузера каждое семейство шаблона и ждёт готовности', async () => {
    const load = vi.fn(async (_font: string) => []);
    const fonts: FontLoader = { load, ready: Promise.resolve() };
    await loadFonts(['Montserrat', 'PT Serif'], fonts);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls[0]?.[0]).toContain('"Montserrat"');
  });

  it('не падает, если шрифт загрузить не удалось', async () => {
    const fonts: FontLoader = {
      load: () => Promise.reject(new Error('bad font')),
      ready: Promise.resolve(),
    };
    await expect(loadFonts(['Broken'], fonts)).resolves.toBeUndefined();
  });

  it('пропускает пустое имя шрифта', async () => {
    const load = vi.fn(async (_font: string) => []);
    await loadFonts(['  '], { load, ready: Promise.resolve() });
    expect(load).not.toHaveBeenCalled();
  });
});

describe('decodeImages', () => {
  it('раскодирует каждую картинку и не падает на битой', async () => {
    const made: DecodableImage[] = [];
    const createImage = (): DecodableImage => {
      const img: DecodableImage = {
        src: '',
        decode: () =>
          img.src.includes('broken') ? Promise.reject(new Error('decode')) : Promise.resolve(),
      };
      made.push(img);
      return img;
    };
    await expect(decodeImages(['/a.png', '/broken.png'], createImage)).resolves.toBeUndefined();
    expect(made.map((img) => img.src)).toEqual(['/a.png', '/broken.png']);
  });
});

describe('slideImageUrls', () => {
  it('берёт картинки, которые источник смог отдать, без повторов', () => {
    const slide = {
      elements: [image('a', 'ppt/media/1.png'), image('b', 'ppt/media/1.png'), image('c', 'x.png')],
    };
    expect(slideImageUrls(slide, { 'ppt/media/1.png': '/media/1.png' })).toEqual(['/media/1.png']);
  });
});
