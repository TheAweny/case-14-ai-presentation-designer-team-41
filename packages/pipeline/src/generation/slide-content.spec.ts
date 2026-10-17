import { describe, expect, it } from 'vitest';
import {
  placeSlideContent,
  type PlacementComposition,
  type SlideContent,
} from './slide-content.js';

function layout(patternId: string, slots: PlacementComposition['slots']): PlacementComposition {
  return { patternId, slots };
}

const title = 'Сеть уже собирает показания';
const first = 'Датчики стоят в каждом подъезде.';
const second = 'Диспетчер видит заявку сразу.';

describe('placeSlideContent', () => {
  it('gives three variants the same sentences and leaves extra cards empty', () => {
    const content: SlideContent = {
      title,
      blocks: [
        { blockId: 'sensors', text: first, claimIds: ['claim-sensors'] },
        { blockId: 'desk', text: second, claimIds: ['claim-desk'] },
      ],
    };
    const placed = placeSlideContent(content, {
      dense: layout('wide-cards', [
        { slotId: 'wide-title', role: 'title', fitChars: title.length },
        { slotId: 'wide-a', role: 'body', fitChars: first.length },
        { slotId: 'wide-kicker', role: 'title', fitChars: 40 },
        { slotId: 'wide-b', role: 'body', fitChars: second.length },
        { slotId: 'wide-extra', role: 'body', fitChars: 80 },
      ]),
      balanced: layout('mid-cards', [
        { slotId: 'mid-title', role: 'title', fitChars: title.length },
        { slotId: 'mid-1', role: 'body', fitChars: first.length },
        { slotId: 'mid-2', role: 'body', fitChars: second.length },
        { slotId: 'mid-spare', role: 'body', fitChars: 60 },
      ]),
      airy: layout('narrow-cards', [
        { slotId: 'slim-title', role: 'title', fitChars: title.length + 4 },
        { slotId: 'slim-1', role: 'body', fitChars: first.length },
        { slotId: 'slim-2', role: 'body', fitChars: second.length },
      ]),
    });

    expect(placed.dense).toMatchObject({ ok: true });
    expect(placed.balanced).toMatchObject({ ok: true });
    expect(placed.airy).toMatchObject({ ok: true });
    if (!placed.dense.ok || !placed.balanced.ok || !placed.airy.ok) return;

    expect(placed.dense.textsBySlot).toEqual({
      'wide-title': title,
      'wide-a': first,
      'wide-kicker': '',
      'wide-b': second,
      'wide-extra': '',
    });
    expect(placed.balanced.textsBySlot).toEqual({
      'mid-title': title,
      'mid-1': first,
      'mid-2': second,
      'mid-spare': '',
    });
    expect(placed.airy.textsBySlot).toEqual({
      'slim-title': title,
      'slim-1': first,
      'slim-2': second,
    });
    expect(placed.dense.blocks.map((block) => block.text)).toEqual([first, second]);
    expect(placed.airy.blocks.map((block) => block.text)).toEqual([first, second]);
    expect(placed.dense.blocks.map((block) => block.slotId)).toEqual(['wide-a', 'wide-b']);
    expect(placed.airy.blocks.map((block) => block.slotId)).toEqual(['slim-1', 'slim-2']);
    expect(placed.balanced.blocks[0]?.text).toBe(content.blocks[0]?.text);
    expect(placed.balanced.blocks[1]?.text).toBe(content.blocks[1]?.text);
  });

  it('returns cannotFit when the sentence would be cut inside a word', () => {
    const text = 'Сеть покрывает три района';
    const cutAt = text.indexOf('покрывает') + 4;
    const midWord = text.slice(0, cutAt);
    expect(midWord).toBe('Сеть покр');
    expect(midWord.endsWith(' ')).toBe(false);

    const placed = placeSlideContent(
      {
        title: 'Покрытие',
        blocks: [{ blockId: 'coverage', text, claimIds: ['claim-coverage'] }],
      },
      {
        airy: layout('narrow-line', [
          { slotId: 'narrow-title', role: 'title', fitChars: 20 },
          { slotId: 'narrow-body', role: 'body', fitChars: cutAt },
        ]),
        dense: layout('roomy-line', [
          { slotId: 'roomy-title', role: 'title', fitChars: 20 },
          { slotId: 'roomy-body', role: 'body', fitChars: text.length },
        ]),
      },
    );

    expect(placed.airy).toEqual({ ok: false, reason: 'cannotFit', blockId: 'coverage' });
    expect(JSON.stringify(placed.airy)).not.toContain(midWord);
    expect(JSON.stringify(placed.airy)).not.toContain(text);
    expect(placed.dense).toMatchObject({
      ok: true,
      textsBySlot: { 'roomy-title': 'Покрытие', 'roomy-body': text },
    });
  });

  it('returns cannotFit when a block has no content slot', () => {
    const placed = placeSlideContent(
      {
        title: 'Два пункта',
        blocks: [
          { blockId: 'first', text: 'Первый пункт умещается.' },
          { blockId: 'second', text: 'Второму пункту нет карточки.' },
        ],
      },
      {
        balanced: layout('one-card', [
          { slotId: 'one-title', role: 'title', fitChars: 40 },
          { slotId: 'one-body', role: 'body', fitChars: 40 },
        ]),
      },
    ).balanced;

    expect(placed).toEqual({ ok: false, reason: 'cannotFit', blockId: 'second' });
  });

  it('returns cannotFit when the slide has a table and the composition has no visual slot', () => {
    const placed = placeSlideContent(
      {
        title: 'Выручка',
        blocks: [],
        visual: { kind: 'table', headers: ['Год'], rows: [['2024']] },
      },
      {
        balanced: layout('title-only', [{ slotId: 'only-title', role: 'title', fitChars: 40 }]),
      },
    ).balanced;

    expect(placed).toEqual({ ok: false, reason: 'cannotFit', blockId: 'visual' });
  });

  it('preserves missing claim ids on the placed block', () => {
    const claimIds = ['fact-12'];
    const content: SlideContent = {
      title: 'Итог',
      blocks: [
        { blockId: 'plain', text: 'Пилот прошёл на двух площадках.' },
        { blockId: 'sourced', text: 'Срок пилота — шесть недель.', claimIds },
        { blockId: 'none', text: 'Следующий шаг — решение заказчика.', claimIds: [] },
      ],
    };
    const placed = placeSlideContent(content, {
      balanced: layout('three-cards', [
        { slotId: 'card-title', role: 'title', fitChars: 20 },
        { slotId: 'card-1', role: 'body', fitChars: 80 },
        { slotId: 'card-2', role: 'body', fitChars: 80 },
        { slotId: 'card-3', role: 'body', fitChars: 80 },
      ]),
    }).balanced;

    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.blocks[0]).toEqual({
      blockId: 'plain',
      slotId: 'card-1',
      text: 'Пилот прошёл на двух площадках.',
    });
    expect(placed.blocks[0]).not.toHaveProperty('claimIds');
    expect(placed.blocks[1]?.claimIds).toEqual(['fact-12']);
    expect(placed.blocks[1]?.claimIds).not.toBe(claimIds);
    expect(placed.blocks[2]?.claimIds).toEqual([]);
    expect(content.blocks[0]).not.toHaveProperty('claimIds');
  });
});
