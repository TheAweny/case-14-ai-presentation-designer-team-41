import {
  generationProfileSchema,
  storedTemplateIndexSchema,
  type Composition,
  type CompositionNote,
  type GenerationProfile,
  type ImageSlot,
} from '@lct/contracts';

const TEXT_PAGE = 20;
const IMAGE_PAGE = 20;
const LABEL_LIMIT = 200;
const JSON_LIMIT = 10_000;

export class TemplateLayoutError extends Error {
  readonly code: 'invalid_profile' | 'unknown_layout' | 'response_too_large';

  constructor(code: 'invalid_profile' | 'unknown_layout' | 'response_too_large', message: string) {
    super(message);
    this.name = 'TemplateLayoutError';
    this.code = code;
  }
}

export type LayoutBox = { x: number; y: number; cx: number; cy: number };

export type LayoutTextSlot = {
  slotId: string;
  role: 'title' | 'body';
  maxChars: number;
  maxLines: number;
  fontSize: number;
  font: string;
  box: LayoutBox | null;
  sample: { text: string; sampleOnly: true };
};

export type LayoutImageSlot = {
  slotId: string;
  kind: ImageSlot['kind'];
  box: LayoutBox;
};

/** Fields the index actually stores. Groups and card headings are not among them. */
export type LayoutSemantics = {
  kind: CompositionNote['kind'];
  items: number;
  useFor: string;
  title: string;
  skip: boolean;
  special: boolean;
  requiredContent: CompositionNote['requiredContent'];
};

export type TemplateLayoutView = {
  templateHash: string;
  patternId: string;
  name: string;
  sourceIndex: number;
  textSlots: LayoutTextSlot[];
  totalSlots: number;
  offset: number;
  nextOffset: number | null;
  truncated: boolean;
  imageSlots: LayoutImageSlot[];
  imageSlotCount: number;
  imageOffset: number;
  imageNextOffset: number | null;
  imageSlotsTruncated: boolean;
  imageCount: number;
  semantics: LayoutSemantics | null;
  groups: 'unknown';
  cardHeadings: 'unknown';
};

function clip(value: string, max = LABEL_LIMIT): string {
  return value.length <= max ? value : value.slice(0, max);
}

function parseProfile(profile: unknown): GenerationProfile {
  const parsed = generationProfileSchema.safeParse(profile);
  if (!parsed.success) {
    throw new TemplateLayoutError('invalid_profile', 'Профиль шаблона не прошёл проверку.');
  }
  return parsed.data;
}

function assertOffset(offset: number, message: string): void {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new TemplateLayoutError('invalid_profile', message);
  }
}

function matchingNote(
  profile: GenerationProfile,
  index: unknown,
  patternId: string,
  labelMax: number,
): LayoutSemantics | null {
  const parsed = storedTemplateIndexSchema.safeParse(index);
  if (!parsed.success || parsed.data.templateHash !== profile.templateHash) return null;
  const note = parsed.data.notes.find((item) => item.patternId === patternId);
  if (!note) return null;
  return {
    kind: note.kind,
    items: note.items,
    useFor: clip(note.useFor, labelMax),
    title: clip(note.title, labelMax),
    skip: note.skip,
    special: note.special,
    requiredContent: [...note.requiredContent],
  };
}

function textSlot(slot: Composition['slots'][number], sampleMax: number): LayoutTextSlot {
  return {
    slotId: slot.slotId,
    role: slot.role,
    maxChars: slot.maxChars,
    maxLines: slot.maxLines,
    fontSize: slot.fontSize,
    font: clip(slot.font, sampleMax),
    box: slot.box ? { x: slot.box.x, y: slot.box.y, cx: slot.box.cx, cy: slot.box.cy } : null,
    sample: { text: clip(slot.sample, sampleMax), sampleOnly: true },
  };
}

function imageSlotOf(slot: ImageSlot): LayoutImageSlot {
  return {
    slotId: slot.slotId,
    kind: slot.kind,
    box: { x: slot.box.x, y: slot.box.y, cx: slot.box.cx, cy: slot.box.cy },
  };
}

function viewOf(
  profile: GenerationProfile,
  composition: Composition,
  index: unknown,
  offset: number,
  imageOffset: number,
  textSlots: LayoutTextSlot[],
  imageSlots: LayoutImageSlot[],
  labelMax: number,
): TemplateLayoutView {
  const textNext = offset + textSlots.length;
  const imageNext = imageOffset + imageSlots.length;
  const images = composition.imageSlots ?? [];
  return {
    templateHash: profile.templateHash,
    patternId: composition.patternId,
    name: clip(composition.name, labelMax),
    sourceIndex: composition.sourceIndex,
    textSlots,
    totalSlots: composition.slots.length,
    offset,
    nextOffset: textNext < composition.slots.length ? textNext : null,
    truncated: textNext < composition.slots.length,
    imageSlots,
    imageSlotCount: images.length,
    imageOffset,
    imageNextOffset: imageNext < images.length ? imageNext : null,
    imageSlotsTruncated: imageNext < images.length,
    imageCount: composition.imageCount,
    semantics: matchingNote(profile, index, composition.patternId, labelMax),
    groups: 'unknown',
    cardHeadings: 'unknown',
  };
}

function tooLarge(): never {
  throw new TemplateLayoutError(
    'response_too_large',
    'Даже один слот с полным идентификатором не помещается в ответ.',
  );
}

/**
 * One page of a composition as the profile states it. Text and pictures page separately.
 * Identifiers stay intact; labels and samples shrink, then the page counts shrink, so the
 * cursors still address every remaining slot. The index adds a note only when its hash matches.
 */
export function inspectTemplateLayout(
  profile: unknown,
  index: unknown,
  patternId: string,
  offset = 0,
  imageOffset = 0,
): TemplateLayoutView {
  const parsed = parseProfile(profile);
  assertOffset(offset, 'Смещение текста должно быть целым неотрицательным числом.');
  assertOffset(imageOffset, 'Смещение картинок должно быть целым неотрицательным числом.');
  const composition = parsed.compositions.find((item) => item.patternId === patternId);
  if (!composition) {
    throw new TemplateLayoutError('unknown_layout', 'Макет с таким patternId в профиле не найден.');
  }
  const images = composition.imageSlots ?? [];
  const textBudget = Math.min(TEXT_PAGE, Math.max(0, composition.slots.length - offset));
  const imageBudget = Math.min(IMAGE_PAGE, Math.max(0, images.length - imageOffset));
  let sampleMax = LABEL_LIMIT;
  let textTake = textBudget;
  let imageTake = imageBudget;

  const build = () =>
    viewOf(
      parsed,
      composition,
      index,
      offset,
      imageOffset,
      composition.slots.slice(offset, offset + textTake).map((slot) => textSlot(slot, sampleMax)),
      images.slice(imageOffset, imageOffset + imageTake).map(imageSlotOf),
      sampleMax,
    );

  let fitted = build();
  while (JSON.stringify(fitted).length >= JSON_LIMIT && sampleMax > 0) {
    sampleMax = Math.max(0, sampleMax - 20);
    fitted = build();
  }
  while (JSON.stringify(fitted).length >= JSON_LIMIT && (textTake > 0 || imageTake > 0)) {
    if (textTake > imageTake && textTake > 1) textTake -= 1;
    else if (imageTake > 1) imageTake -= 1;
    else if (textTake > 1) textTake -= 1;
    else if (imageTake > 0 && textTake > 0) imageTake = 0;
    else if (textTake > 0) textTake = 0;
    else imageTake = 0;
    fitted = build();
  }
  if (JSON.stringify(fitted).length >= JSON_LIMIT) tooLarge();
  if (textBudget > 0 && textTake === 0) tooLarge();
  if (imageBudget > 0 && imageTake === 0) tooLarge();
  return fitted;
}
