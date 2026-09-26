import { describe, expect, it } from 'vitest';
import type { ElementRole, SlideElement, SlideIr } from '@lct/contracts';
import {
  MAX_CONTEXT_REFS,
  addRef,
  contextAttachments,
  contextMentions,
  createSlideRef,
  ghostRef,
  refKey,
  refSubject,
  removeRef,
  resolveRef,
  type SlideRef,
} from './slide-context';

const box = { x: 0, y: 0, cx: 100, cy: 100 };

function text(elementId: string, role: ElementRole): SlideElement {
  return {
    kind: 'text',
    elementId,
    role,
    box,
    sourceShapeId: null,
    paragraphs: [{ level: 0, runs: [{ text: elementId }] }],
    overflow: null,
  } as SlideElement;
}

function shape(elementId: string, groupIds?: readonly string[]): SlideElement {
  return {
    kind: 'decor',
    elementId,
    role: 'decoration',
    box,
    sourceShapeId: null,
    shape: 'ellipse',
    ...(groupIds ? { groupIds: [...groupIds] } : null),
  };
}

const photo: SlideElement = {
  kind: 'image',
  elementId: 'photo',
  role: 'image',
  box,
  sourceShapeId: null,
  mediaPart: 'upload/photo.png',
  fit: 'cover',
};

function slide(slideId: string, elements: readonly SlideElement[]): SlideIr {
  return {
    schemaVersion: 1,
    slideId,
    variant: 'balanced',
    index: 0,
    patternId: 'p',
    slideCx: 1000,
    slideCy: 500,
    elements: [...elements],
  };
}

const deck = [
  slide('s1', [text('title', 'title'), text('body', 'body')]),
  slide('s2', [photo, shape('a', ['card']), shape('b', ['card']), shape('dot')]),
  slide('s3', []),
];

function ref(slideId: string, elementIds: readonly string[]): SlideRef {
  const made = createSlideRef(deck, slideId, elementIds);
  if (!made) throw new Error('no ref');
  return made;
}

describe('о чём ссылка', () => {
  it('один объект — по роли и типу, без знания о шаблоне', () => {
    expect(refSubject(deck[0] as SlideIr, ['title'])).toEqual({
      kind: 'element',
      elementKind: 'text',
      role: 'title',
    });
    expect(refSubject(deck[1] as SlideIr, ['photo'])).toMatchObject({ elementKind: 'image' });
    expect(refSubject(deck[1] as SlideIr, ['dot'])).toMatchObject({ shape: 'ellipse' });
  });

  it('пусто — весь слайд, группа целиком — группа, группа и объекты — считаются узлами', () => {
    expect(refSubject(deck[1] as SlideIr, [])).toEqual({ kind: 'slide' });
    expect(refSubject(deck[1] as SlideIr, ['a', 'b'])).toEqual({ kind: 'group' });
    expect(refSubject(deck[1] as SlideIr, ['a', 'b', 'photo', 'dot'])).toEqual({
      kind: 'many',
      count: 3,
    });
  });

  it('ссылка помнит номер слайда и берёт объекты в порядке наложения', () => {
    const made = ref('s2', ['dot', 'photo']);
    expect(made.slideNumber).toBe(2);
    expect(made.elementIds).toEqual(['photo', 'dot']);
    expect(createSlideRef(deck, 's2', ['gone'])).toBeNull();
    expect(createSlideRef(deck, 'missing', [])).toBeNull();
  });
});

describe('поле ассистента', () => {
  it('тот же набор объектов — один чип, в каком порядке его ни выделяли', () => {
    const first = addRef([], ref('s1', ['title', 'body']));
    const again = addRef(first, ref('s1', ['body', 'title']));
    expect(again).toBe(first);
    expect(addRef(first, ref('s1', ['title']))).toHaveLength(2);
  });

  it('больше предела — уходит самая старая ссылка', () => {
    let refs: readonly SlideRef[] = [];
    const ids = ['title', 'body'];
    refs = addRef(refs, ref('s1', []), 2);
    refs = addRef(refs, ref('s1', ids.slice(0, 1)), 2);
    refs = addRef(refs, ref('s2', []), 2);
    expect(refs.map(refKey)).toEqual([refKey(ref('s1', ['title'])), refKey(ref('s2', []))]);
    expect(MAX_CONTEXT_REFS).toBeGreaterThan(2);
  });

  it('убрать — по ключу', () => {
    const refs = addRef(addRef([], ref('s1', [])), ref('s2', []));
    expect(removeRef(refs, refKey(ref('s1', [])))).toEqual([ref('s2', [])]);
  });

  it('призрак — текущее выделение, пока его не убрали и не закрепили', () => {
    const ghost = ghostRef(deck, 's1', ['title'], [], null);
    expect(ghost?.subject).toMatchObject({ role: 'title' });
    expect(ghostRef(deck, 's1', [], [], null)).toBeNull();
    expect(ghostRef(deck, 's1', ['title'], [], refKey(ref('s1', ['title'])))).toBeNull();
    expect(ghostRef(deck, 's1', ['title'], [ref('s1', ['title'])], null)).toBeNull();
    // Убрали другое выделение — этот призрак остаётся.
    expect(ghostRef(deck, 's1', ['title'], [], refKey(ref('s1', ['body'])))).not.toBeNull();
  });
});

describe('устаревшие ссылки', () => {
  it('слайда нет — устарела', () => {
    expect(resolveRef(deck.slice(1), ref('s1', []))).toEqual({
      status: 'stale',
      reason: 'slide-removed',
    });
  });

  it('объекты удалены все — устарела, часть — живая с оставшимися', () => {
    const edited = [slide('s1', [text('body', 'body')]), ...deck.slice(1)];
    expect(resolveRef(edited, ref('s1', ['title']))).toEqual({
      status: 'stale',
      reason: 'elements-removed',
    });
    expect(resolveRef(edited, ref('s1', ['title', 'body']))).toMatchObject({
      status: 'live',
      elementIds: ['body'],
      subject: { kind: 'element', role: 'body' },
    });
  });

  it('слайд переехал — номер берётся с нового места', () => {
    const moved = [deck[1] as SlideIr, deck[0] as SlideIr];
    expect(resolveRef(moved, ref('s1', ['title']))).toMatchObject({ slideNumber: 2 });
  });
});

describe('снимок для агента', () => {
  it('объекты — фрагменты SlideIR, слайд — SlideIR целиком; устаревшее не уходит', () => {
    const edited = [deck[0] as SlideIr, slide('s2', [photo])];
    const attachments = contextAttachments(edited, [
      ref('s1', ['title']),
      ref('s2', ['a', 'b']),
      ref('s2', []),
    ]);
    expect(attachments).toHaveLength(2);
    expect(attachments[0]?.context).toEqual({
      scope: 'elements',
      slideNumber: 1,
      slideId: 's1',
      elements: [(deck[0] as SlideIr).elements[0]],
    });
    expect(attachments[1]?.context).toEqual({ scope: 'slide', slideNumber: 2, slide: edited[1] });
  });

  it('закреплённое и тот же призрак уходят один раз', () => {
    const title = ref('s1', ['title']);
    expect(contextAttachments(deck, [title, title])).toHaveLength(1);
  });

  it('упоминания для ответа — только ссылки на слайды, по порядку', () => {
    const attachments = [
      { kind: 'file' as const, name: 'a.csv', size: 1 },
      ...contextAttachments(deck, [ref('s1', ['title']), ref('s2', ['photo', 'dot'])]),
    ];
    expect(contextMentions(attachments)).toEqual([
      { subject: { kind: 'element', elementKind: 'text', role: 'title' }, slideNumber: 1 },
      { subject: { kind: 'many', count: 2 }, slideNumber: 2 },
    ]);
  });
});
