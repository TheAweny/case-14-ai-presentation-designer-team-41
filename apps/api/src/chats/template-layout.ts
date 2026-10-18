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

export type SemanticRole = 'slide-title' | 'card-heading' | 'body' | 'caption' | 'unknown';

export type LayoutGroup = {
  id: string;
  kind: 'card' | 'step' | 'column';
  slotIds: string[];
};

export type LayoutTextSlot = {
  slotId: string;
  role: 'title' | 'body';
  semanticRole: SemanticRole;
  groupId?: string;
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
  /** Groups that own a text slot on this page. Unknown until a matching index names them. */
  groups: 'unknown' | LayoutGroup[];
  /** Slot ids on this page whose index role is card-heading. Unknown until the index says. */
  cardHeadings: 'unknown' | string[];
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

type SlotMeaning = { role: SemanticRole; groupId?: string };

function indexSemantics(
  profile: GenerationProfile,
  index: unknown,
  patternId: string,
): {
  meanings: Map<string, SlotMeaning>;
  groups: CompositionNote['groups'];
  namedRoles: boolean;
} | null {
  const parsed = storedTemplateIndexSchema.safeParse(index);
  if (!parsed.success || parsed.data.templateHash !== profile.templateHash) return null;
  const note = parsed.data.notes.find((item) => item.patternId === patternId);
  if (!note) return null;
  const known = new Set(
    profile.compositions
      .find((item) => item.patternId === patternId)
      ?.slots.map((slot) => slot.slotId) ?? [],
  );
  const groups: NonNullable<CompositionNote['groups']> = [];
  const taken = new Set<string>();
  const seenGroupIds = new Set<string>();
  for (const group of note.groups ?? []) {
    if (seenGroupIds.has(group.id)) continue;
    const slotIds: string[] = [];
    const local = new Set<string>();
    for (const slotId of group.slotIds) {
      if (!known.has(slotId) || taken.has(slotId) || local.has(slotId)) continue;
      local.add(slotId);
      slotIds.push(slotId);
    }
    if (slotIds.length === 0) continue;
    seenGroupIds.add(group.id);
    for (const slotId of slotIds) taken.add(slotId);
    groups.push({ id: group.id, kind: group.kind, slotIds });
  }
  const members = new Map(groups.map((group) => [group.id, new Set(group.slotIds)]));
  const meanings = new Map<string, SlotMeaning>();
  for (const item of note.slotSemantics ?? []) {
    if (!known.has(item.slotId) || meanings.has(item.slotId)) continue;
    meanings.set(item.slotId, {
      role: item.role,
      ...(item.groupId && members.get(item.groupId)?.has(item.slotId)
        ? { groupId: item.groupId }
        : {}),
    });
  }
  return {
    meanings,
    groups: note.groups ? groups : undefined,
    namedRoles: note.slotSemantics !== undefined,
  };
}

function textSlot(
  slot: Composition['slots'][number],
  sampleMax: number,
  meaning: SlotMeaning | undefined,
): LayoutTextSlot {
  return {
    slotId: slot.slotId,
    role: slot.role,
    semanticRole: meaning?.role ?? 'unknown',
    ...(meaning?.groupId ? { groupId: meaning.groupId } : {}),
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

function pageGroups(
  textSlots: LayoutTextSlot[],
  groups: CompositionNote['groups'],
): 'unknown' | LayoutGroup[] {
  if (!groups) return 'unknown';
  const onPage = new Set(textSlots.map((slot) => slot.slotId));
  return groups
    .map((group) => ({
      id: group.id,
      kind: group.kind,
      slotIds: group.slotIds.filter((slotId) => onPage.has(slotId)),
    }))
    .filter((group) => group.slotIds.length > 0);
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
  const semantics = indexSemantics(profile, index, composition.patternId);
  const namedRoles = semantics?.namedRoles === true;
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
    groups: pageGroups(textSlots, semantics?.groups),
    cardHeadings: namedRoles
      ? textSlots.filter((slot) => slot.semanticRole === 'card-heading').map((slot) => slot.slotId)
      : 'unknown',
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
      composition.slots
        .slice(offset, offset + textTake)
        .map((slot) =>
          textSlot(
            slot,
            sampleMax,
            indexSemantics(parsed, index, composition.patternId)?.meanings.get(slot.slotId),
          ),
        ),
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
