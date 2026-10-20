import { describe, expect, it } from 'vitest';
import type { GenerationProfile } from '@lct/contracts';
import { geometricCovers, titleCovers } from './workflow.js';

type Composition = GenerationProfile['compositions'][number];

const slot = (slotId: string, role: 'title' | 'body', maxChars: number, fontSize: number) => ({
  slotId,
  role,
  sample: role === 'title' ? 'Заголовок' : 'Содержание',
  font: 'Inter',
  fontSize,
  maxChars,
  maxLines: role === 'title' ? 2 : 10,
});
const pattern = (patternId: string, body: number[]) =>
  ({
    patternId,
    sourceIndex: 1,
    name: patternId,
    imageCount: 0,
    slots: [
      slot('title', 'title', 60, 40),
      ...body.map((chars, i) => slot(`b${i}`, 'body', chars, 16)),
    ],
  }) as unknown as Composition;

describe('geometricCovers', () => {
  it('takes a large-title layout without room for a chart over a content slide', () => {
    const content = pattern('content', [600]);
    const cover = pattern('cover', [60]);
    expect(geometricCovers([content, cover], [content, cover])).toEqual([cover]);
  });

  it('falls back to the first titled layout of the template when nothing qualifies', () => {
    const first = pattern('first', [600]);
    const second = pattern('second', [600, 600, 600]);
    expect(geometricCovers([second], [first, second])).toEqual([first]);
  });

  it('prefers a cover with a title and one line over a list of findings', () => {
    const list = pattern('list', [80, 80, 80]);
    const title = pattern('title', [80]);
    expect(titleCovers([list, title])).toEqual([title]);
    expect(titleCovers([list])).toEqual([list]);
  });
});
