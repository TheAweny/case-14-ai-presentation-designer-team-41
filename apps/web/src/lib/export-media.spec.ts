import { describe, expect, it, vi } from 'vitest';
import type { SlideIr } from '@lct/contracts';
import { DEMO_DECK } from '../mocks/demo-deck';
import { collectExportMedia, EXPORT_MEDIA_BYTES } from './export-media';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2kAAAAASUVORK5CYII=';
const png = () => new Blob([Buffer.from(PNG, 'base64')], { type: 'image/png' });
const firstSlide = DEMO_DECK.slides[0];
if (!firstSlide) throw new Error('Expected fixture slide');
const slides = (...parts: string[]): SlideIr[] => [
  {
    ...firstSlide,
    elements: parts.map((mediaPart, index) => ({
      kind: 'image',
      role: 'image',
      elementId: `image-${index}`,
      sourceShapeId: null,
      mediaPart,
      fit: 'contain',
      box: { x: 0, y: 0, cx: 1000000, cy: 1000000 },
    })),
  },
];

describe('export media', () => {
  it('sends exact PNG bytes once for referenced uploads and ignores template media', async () => {
    const file = vi.fn(() => png());
    expect(
      await collectExportMedia(slides('upload/a.png', 'upload/a.png', 'ppt/media/image1.png'), {
        file,
      }),
    ).toEqual([{ mediaPart: 'upload/a.png', dataUrl: `data:image/png;base64,${PNG}` }]);
    expect(file).toHaveBeenCalledTimes(1);
  });
  it('explicitly fails for missing files', async () => {
    await expect(collectExportMedia(slides('upload/a.png'), { file: () => null })).rejects.toThrow(
      'Не найден файл',
    );
  });
  it.each(['upload/../a.png', 'upload/a.svg', 'upload/a.PNG'])(
    'refuses invalid parts %s',
    async (part) => {
      await expect(collectExportMedia(slides(part), { file: () => png() })).rejects.toThrow();
    },
  );
  it('rejects MIME mismatch, fake image bytes and excessive dimensions', async () => {
    for (const file of [
      new Blob(['not png'], { type: 'image/png' }),
      new Blob([Buffer.from(PNG, 'base64')], { type: 'image/jpeg' }),
    ]) {
      await expect(
        collectExportMedia(slides('upload/a.png'), { file: () => file }),
      ).rejects.toThrow();
    }
    const large = Buffer.from(PNG, 'base64');
    large.writeUInt32BE(100000, 16);
    await expect(
      collectExportMedia(slides('upload/a.png'), {
        file: () => new Blob([large], { type: 'image/png' }),
      }),
    ).rejects.toThrow();
  });
  it('checks count and individual and aggregate byte limits before encoding', async () => {
    const over = new Blob([new Uint8Array(EXPORT_MEDIA_BYTES + 1)], { type: 'image/png' });
    await expect(collectExportMedia(slides('upload/a.png'), { file: () => over })).rejects.toThrow(
      '1 МиБ',
    );
    await expect(
      collectExportMedia(slides(...Array.from({ length: 33 }, (_, i) => `upload/${i}.png`)), {
        file: () => png(),
      }),
    ).rejects.toThrow('32');
    const padded = Buffer.alloc(EXPORT_MEDIA_BYTES);
    Buffer.from(PNG, 'base64').copy(padded);
    await expect(
      collectExportMedia(slides('upload/a.png', 'upload/b.png', 'upload/c.png', 'upload/d.png'), {
        file: () => new Blob([padded], { type: 'image/png' }),
      }),
    ).rejects.toThrow('3 МиБ');
  });
  it('accepts a JPEG frame and preserves its bytes', async () => {
    const bytes = Buffer.from([255, 216, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 255, 217]);
    expect(
      await collectExportMedia(slides('upload/a.jpeg'), {
        file: () => new Blob([bytes], { type: 'image/jpeg' }),
      }),
    ).toEqual([
      { mediaPart: 'upload/a.jpeg', dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}` },
    ]);
  });
  it('honours cancellation before and after reading file bytes', async () => {
    const aborted = AbortSignal.abort(new Error('cancelled'));
    const file = vi.fn(() => png());
    await expect(collectExportMedia(slides('upload/a.png'), { file }, aborted)).rejects.toThrow(
      'cancelled',
    );
    expect(file).not.toHaveBeenCalled();
    const controller = new AbortController();
    const blob = png();
    vi.spyOn(blob, 'arrayBuffer').mockImplementation(async () => {
      controller.abort(new Error('cancelled read'));
      return new ArrayBuffer(0);
    });
    await expect(
      collectExportMedia(
        slides('upload/a.png', 'upload/b.png'),
        { file: () => blob },
        controller.signal,
      ),
    ).rejects.toThrow('cancelled read');
  });
});
