import { describe, expect, it } from 'vitest';
import type { SlideIr } from '@lct/contracts';
import { DEMO_DECK } from '../mocks/demo-deck';
import {
  DRAFT_VERSION,
  createDraft,
  deckFingerprint,
  draftKey,
  mediaKey,
  mediaPrefix,
  readDraft,
  sameSlides,
  uploadPartsOf,
} from './deck-draft';

const slides = DEMO_DECK.slides;
const base = deckFingerprint(slides);

/** Демо-колода, где на первом слайде лежит картинка с этой частью. */
function withImage(part: string): SlideIr[] {
  const [first, ...rest] = slides;
  if (!first) throw new Error('demo deck is empty');
  const image: SlideIr['elements'][number] = {
    kind: 'image',
    elementId: 'upload-image',
    role: 'image',
    box: { x: 0, y: 0, cx: 100, cy: 100 },
    sourceShapeId: null,
    mediaPart: part,
    fit: 'contain',
  };
  return [{ ...first, elements: [...first.elements, image] }, ...rest];
}

describe('deck draft', () => {
  it('раскладывает ключи по колоде', () => {
    expect(draftKey('demo')).toBe('draft:demo');
    expect(mediaKey('demo', 'upload/a.png')).toBe('media:demo:upload/a.png');
    expect(mediaKey('demo', 'upload/a.png').startsWith(mediaPrefix('demo'))).toBe(true);
    expect(mediaKey('demo-2', 'upload/a.png').startsWith(mediaPrefix('demo'))).toBe(false);
  });

  it('узнаёт ту же колоду по отпечатку, а другую — по любой правке', () => {
    const moved = withImage('upload/a.png');
    expect(deckFingerprint(structuredClone(slides))).toBe(base);
    expect(deckFingerprint(moved)).not.toBe(base);
    expect(sameSlides(slides, structuredClone(slides))).toBe(true);
    expect(sameSlides(slides, moved)).toBe(false);
  });

  it('помнит только загруженные картинки, по одному разу', () => {
    const edited = withImage('upload/a.png');
    const [first] = edited;
    if (!first) throw new Error('demo deck is empty');
    expect(uploadPartsOf([...edited, { ...first, slideId: 'copy' }])).toEqual(['upload/a.png']);
    expect(uploadPartsOf(withImage('ppt/media/image1.png'))).toEqual([]);
  });

  it('читает свой черновик', () => {
    const draft = createDraft('demo', base, withImage('upload/a.png'), 42);
    const read = readDraft(structuredClone(draft), { deckId: 'demo', base });
    expect(read?.slides).toEqual(draft.slides);
    expect(read?.media).toEqual(['upload/a.png']);
    expect(read?.savedAt).toBe(42);
  });

  it('пропускает чужую колоду, другую сборку колоды и другую версию формата', () => {
    const draft = createDraft('demo', base, slides, 1);
    expect(readDraft(draft, { deckId: 'other', base })).toBeNull();
    expect(readDraft(draft, { deckId: 'demo', base: 'changed' })).toBeNull();
    expect(
      readDraft({ ...draft, version: DRAFT_VERSION + 1 }, { deckId: 'demo', base }),
    ).toBeNull();
  });

  it('пропускает битую запись, а не открывает сломанную колоду', () => {
    const expected = { deckId: 'demo', base };
    const draft = createDraft('demo', base, slides, 1);
    const [first] = slides;
    expect(readDraft(undefined, expected)).toBeNull();
    expect(readDraft('draft', expected)).toBeNull();
    expect(readDraft({ ...draft, slides: [] }, expected)).toBeNull();
    expect(readDraft({ ...draft, slides: [{ slideId: 'broken' }] }, expected)).toBeNull();
    expect(
      readDraft({ ...draft, slides: [{ ...first, elements: [{ kind: 'text' }] }] }, expected),
    ).toBeNull();
  });
});
