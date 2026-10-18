import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SlideIr } from '@lct/contracts';
import { validateExportMedia, writeExportMedia } from './export-media.js';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2kAAAAASUVORK5CYII=';
const entry = (mediaPart = 'upload/a.png') => ({
  mediaPart,
  dataUrl: `data:image/png;base64,${PNG}`,
});
const slides = (...parts: string[]): SlideIr[] => [
  {
    schemaVersion: 1,
    slideId: 'slide-a',
    index: 0,
    variant: 'balanced',
    patternId: 'pattern',
    slideCx: 9000000,
    slideCy: 6000000,
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

describe('export media validation', () => {
  it('requires all and only referenced upload keys and refuses duplicate entries', () => {
    expect(validateExportMedia(slides('ppt/media/image.png'), undefined)).toEqual([]);
    expect(() => validateExportMedia(slides('upload/a.png'), undefined)).toThrow();
    expect(() => validateExportMedia(slides(), [entry()])).toThrow();
    expect(() => validateExportMedia(slides('upload/a.png'), [entry(), entry()])).toThrow();
    expect(validateExportMedia(slides('upload/a.png', 'upload/a.png'), [entry()])).toHaveLength(1);
  });
  it.each([
    'upload/../a.png',
    'upload/sub/a.png',
    'upload/a.PNG',
    'upload/a.svg',
    '/tmp/a.png',
    'upload/..\\a.png',
  ])('rejects client paths %s', (part) => {
    expect(() => validateExportMedia(slides(part), [entry(part)])).toThrow();
  });
  it('refuses arbitrary path fields, invalid signatures, dimensions, MIME and noncanonical base64', () => {
    const huge = Buffer.from(PNG, 'base64');
    huge.writeUInt32BE(100000, 20);
    for (const input of [
      { ...entry(), path: '/etc/passwd' },
      { ...entry(), dataUrl: 'data:image/png;base64,YWJjZA==' },
      { ...entry(), dataUrl: entry().dataUrl.replace('png', 'jpeg') },
      { ...entry(), dataUrl: `${entry().dataUrl}\n` },
      { ...entry(), dataUrl: entry().dataUrl.replace(/=$/, '') },
      { ...entry(), dataUrl: `data:image/png;base64,${huge.toString('base64')}` },
    ])
      expect(() => validateExportMedia(slides('upload/a.png'), [input])).toThrow();
  });
  it('enforces count and individual and aggregate limits', () => {
    const padded = Buffer.alloc(1024 * 1024);
    Buffer.from(PNG, 'base64').copy(padded);
    const big = {
      ...entry(),
      dataUrl: `data:image/png;base64,${Buffer.alloc(1024 * 1024 + 1).toString('base64')}`,
    };
    expect(() => validateExportMedia(slides('upload/a.png'), [big])).toThrow();
    const entries = Array.from({ length: 4 }, (_, i) => ({
      mediaPart: `upload/${i}.png`,
      dataUrl: `data:image/png;base64,${padded.toString('base64')}`,
    }));
    expect(() =>
      validateExportMedia(slides(...entries.map((e) => e.mediaPart)), entries),
    ).toThrow();
    const many = Array.from({ length: 33 }, (_, i) => entry(`upload/${i}.png`));
    expect(() => validateExportMedia(slides(...many.map((e) => e.mediaPart)), many)).toThrow();
  });
  it('writes exact bytes under only a generated media filename and shares identical content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qr-export-media-'));
    try {
      const validated = validateExportMedia(slides('upload/a.png', 'upload/b.png'), [
        entry(),
        entry('upload/b.png'),
      ]);
      const media = await writeExportMedia(root, validated);
      const [first, second] = media;
      if (!first || !second) throw new Error('Expected two media mappings');
      expect(media.map((m) => m.mediaPart)).toEqual(['upload/a.png', 'upload/b.png']);
      expect(relative(root, first.path)).toMatch(/^media[/\\][a-f0-9]{64}\.png$/);
      expect(first.path).toBe(second.path);
      expect(await readFile(first.path)).toEqual(Buffer.from(PNG, 'base64'));
      expect(await readdir(join(root, 'media'))).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
