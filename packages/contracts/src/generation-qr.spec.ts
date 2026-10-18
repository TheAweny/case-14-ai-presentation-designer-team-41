import { describe, expect, it } from 'vitest';
import {
  composedSlideSchema,
  compositionNoteSchema,
  compositionPlanSchema,
  compositionSchema,
} from './generation.js';
import { deckExportRequestSchema } from './deck-export.js';

describe('QR generation contracts', () => {
  it('accepts candidate pictures without assigning them QR semantics', () => {
    const candidate = { slotId: '3', kind: 'photo', box: { x: 0, y: 0, cx: 1, cy: 1 } };
    const pattern = {
      patternId: 'sample',
      sourceIndex: 0,
      name: 'Sample',
      slots: [
        {
          slotId: '2',
          role: 'title',
          sample: 'Title',
          maxChars: 100,
          maxLines: 2,
          font: 'Arial',
          fontSize: 24,
        },
      ],
      imageCount: 1,
      qrCandidateSlots: [candidate],
    };
    expect(compositionSchema.parse(pattern).qrCandidateSlots).toEqual([candidate]);
    expect(compositionNoteSchema.shape.qrSlotIds.safeParse(Array(11).fill('3')).success).toBe(
      false,
    );
    expect(
      compositionPlanSchema.shape.slides.element.shape.qrRequests.safeParse(
        Array(11).fill({ slotId: '3', url: 'https://example.test' }),
      ).success,
    ).toBe(false);
  });

  it('accepts QR purpose and restricts editor media paths and counts', () => {
    expect(
      composedSlideSchema.shape.images.parse([
        { slotId: '3', path: 'media/qr.png', fit: 'contain', purpose: 'qr' },
      ])?.[0]?.purpose,
    ).toBe('qr');
    const media = deckExportRequestSchema.shape.media;
    expect(media.parse([{ mediaPart: 'upload/qr-1.png', path: 'C:/assets/qr.png' }])).toHaveLength(
      1,
    );
    for (const mediaPart of ['../qr.png', 'upload/../qr.png', 'upload/a.svg', 'media/a.png']) {
      expect(media.safeParse([{ mediaPart, path: 'x' }]).success).toBe(false);
    }
    expect(media.safeParse([{ mediaPart: 'upload/a.png', path: '' }]).success).toBe(false);
    expect(media.safeParse(Array(33).fill({ mediaPart: 'upload/a.png', path: 'x' })).success).toBe(
      false,
    );
  });
});
