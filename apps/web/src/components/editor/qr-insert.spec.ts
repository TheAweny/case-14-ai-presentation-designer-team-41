import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { commitInsert, createDeckHistory, recordChange, undoDeck, redoDeck } from '@lct/deck-ops';
import { DEMO_DECK } from '../../mocks/demo-deck';
import { createDraft, deckFingerprint } from '../../lib/deck-draft';
import { createDraftStorage, type KeyValueStore } from '../../lib/draft-storage';
import { collectExportMedia } from '../../lib/export-media';
import { createMediaRegistry } from '../../lib/media-registry';
import { placeQr, qrImageElement, qrInsertFailure, type QrInsertPart } from './qr-insert';

// A real monochrome PNG for transport/header tests; QR encoding is verified by the encoder tests.
function png(side: number): Buffer {
  const chunk = (type: string, bytes: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), bytes]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const head = Buffer.alloc(4);
    head.writeUInt32BE(bytes.length);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(side, 0);
  ihdr.writeUInt32BE(side, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc((side + 1) * side))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const bytes = png(232);
const firstSlide = DEMO_DECK.slides[0];
if (!firstSlide) throw new Error('Expected fixture slide');
const part: QrInsertPart = {
  url: 'https://example.org/a?sig=A%2fb+%2B&x=1#part',
  pngDataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
  width: 232,
  height: 232,
  moduleCount: 21,
  minSizeEmu: 29 * 38100,
};

describe('QR insertion', () => {
  it('keeps the exact URL and validates PNG headers and metadata', () => {
    expect(qrInsertFailure(part)).toBeNull();
    for (const url of [
      ' https://example.org',
      'https:example.org',
      'https://user:pass@example.org',
      'https://example.org/hello world',
      'https://example.org/\\a',
    ])
      expect(qrInsertFailure({ ...part, url })).toBe('invalid-url');
    for (const change of [
      { moduleCount: 22 },
      { moduleCount: 181 },
      { width: 231 },
      { height: 231 },
      { minSizeEmu: 900000 },
      { minSizeEmu: Number.MAX_SAFE_INTEGER + 1 },
    ])
      expect(qrInsertFailure({ ...part, ...change })).toBe('invalid-size');
    expect(qrInsertFailure({ ...part, pngDataUrl: 'data:image/png;base64,YWJjZA==' })).toBe(
      'invalid-png',
    );
    expect(
      qrInsertFailure({
        ...part,
        pngDataUrl: `data:image/png;base64,${png(233).toString('base64')}`,
      }),
    ).toBe('invalid-png');
    expect(qrInsertFailure({ ...part, pngDataUrl: `${part.pngDataUrl}\n` })).toBe('invalid-png');
  });
  it('uses the content area and refuses a slide smaller than the readable minimum', () => {
    const grid = {
      ...DEMO_DECK.designSystem.grid,
      slideCx: 10_000_000,
      slideCy: 7_000_000,
      marginLeft: 500000,
      marginRight: 500000,
      marginTop: 500000,
      marginBottom: 500000,
    };
    expect(placeQr(grid, part.minSizeEmu)?.side).toBe(1500000);
    expect(placeQr({ ...grid, slideCx: 1800000 }, part.minSizeEmu)).toBeNull();
    expect(placeQr(grid, NaN)).toBeNull();
  });
  it('is selectable, undoable in one step and exports the same bytes after draft reload', async () => {
    const registry = createMediaRegistry({
      createUrl: () => 'blob:qr',
      revokeUrl: () => undefined,
      nextId: () => 'qr',
    });
    const mediaPart = registry.register(
      new File([new Uint8Array(bytes)], 'qr.png', { type: 'image/png' }),
    );
    const placement = placeQr(DEMO_DECK.designSystem.grid, part.minSizeEmu);
    if (!placement) throw new Error('Expected QR to fit fixture');
    const image = qrImageElement(mediaPart, placement.box, 'qr-image');
    const history = recordChange(
      createDeckHistory(DEMO_DECK.slides),
      commitInsert(DEMO_DECK.slides, { slideId: firstSlide.slideId, elements: [image] }),
    );
    expect(history.undo).toHaveLength(1);
    expect(history.undo[0]?.after?.elementIds).toEqual(['qr-image']);
    expect(undoDeck(history).slides).toEqual(DEMO_DECK.slides);
    expect(redoDeck(undoDeck(history)).slides).toEqual(history.slides);
    const data = new Map<string, unknown>();
    const store: KeyValueStore = {
      get: async (key) => data.get(key),
      set: async (key, value) => {
        data.set(key, value);
      },
      del: async (key) => {
        data.delete(key);
      },
      keys: async () => [...data.keys()],
    };
    const base = deckFingerprint(DEMO_DECK.slides);
    await createDraftStorage(store).save(createDraft('qr-deck', base, history.slides, 1), registry);
    const restored = createMediaRegistry({
      createUrl: () => 'blob:restored',
      revokeUrl: () => undefined,
    });
    const draft = await createDraftStorage(store).load('qr-deck', base, restored);
    expect(draft?.slides[0]?.elements.at(-1)).toEqual(image);
    if (!draft) throw new Error('Expected restored draft');
    expect(await collectExportMedia(draft.slides, restored)).toEqual([
      { mediaPart, dataUrl: part.pngDataUrl },
    ]);
  });
});
