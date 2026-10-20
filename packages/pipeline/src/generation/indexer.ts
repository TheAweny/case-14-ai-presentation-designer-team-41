import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { loadAgent } from '@lct/registry';
import {
  compositionNoteSchema,
  storedTemplateIndexSchema,
  type CompositionNote,
  type GenerationProfile,
  type StoredTemplateIndex,
} from '@lct/contracts';
import type { TextProvider } from './provider.js';
import { distinctCompositions, plannerComposition, slotBriefs, writerSlots } from './workflow.js';
import { declaredQrSlots } from './qr-assets.js';
import { dependencyKey } from './checkpoints.js';
import { ModelRequestError } from '../chat/model-failure.js';

/**
 * Compositions per model call: small enough that one answer never runs out of tokens nor out of
 * the time one request has on a slow model. A round that timed out asks again in halves.
 */
const BATCH = 6;
/** Calls per composition at most: the first, then asking again for what the answers left out. */
const ROUNDS = 3;
/** First negotiate one batch; further batches share at most three workers. */
const INDEX_WORKERS = 3;

type Pattern = GenerationProfile['compositions'][number];

/** Indexing so far: compositions with a note, of the distinct compositions of the template. */
export interface IndexProgress {
  described: number;
  total: number;
}

/**
 * What the model answers for a composition. `skip` is not asked: it follows from `kind`, and a
 * small model that has to keep two fields in agreement gets one of them wrong.
 */
const answerNoteSchema = compositionNoteSchema.omit({ skip: true }).extend({
  title: z.string().max(80),
  special: z.boolean(),
});
type AnswerNote = z.infer<typeof answerNoteSchema>;

/**
 * The note as the pipeline trusts it: what the model said, held to what the composition can
 * show. A reference page is skipped and never special; a cover, section or statement is one
 * point; no slide shows more points than it has blocks to write. `inSpecialGroup` — the
 * composition follows a catalog heading of special content.
 */
const SEMANTIC_ROLES = new Set(['slide-title', 'card-heading', 'body', 'caption', 'unknown']);
const GROUP_KINDS = new Set(['card', 'step', 'column']);

/**
 * Keeps only semantic ids that exist on this composition. Unknown ids, a repeated slot, and a
 * group that would put one slot in two groups are dropped. Font size is never consulted.
 */
function settledSemantics(
  answer: AnswerNote,
  pattern: Pattern,
): Pick<CompositionNote, 'slotSemantics' | 'groups'> {
  const known = new Set(pattern.slots.map((slot) => slot.slotId));
  const groups: NonNullable<CompositionNote['groups']> = [];
  const taken = new Set<string>();
  const groupIds = new Set<string>();
  for (const group of answer.groups ?? []) {
    if (!GROUP_KINDS.has(group.kind) || groupIds.has(group.id)) continue;
    const slotIds: string[] = [];
    const local = new Set<string>();
    for (const slotId of group.slotIds) {
      if (!known.has(slotId) || taken.has(slotId) || local.has(slotId)) continue;
      local.add(slotId);
      slotIds.push(slotId);
    }
    if (slotIds.length === 0) continue;
    groupIds.add(group.id);
    for (const slotId of slotIds) taken.add(slotId);
    groups.push({ id: group.id, kind: group.kind, slotIds });
    if (groups.length === 40) break;
  }
  const members = new Map(groups.map((group) => [group.id, new Set(group.slotIds)]));
  const seen = new Set<string>();
  const slotSemantics: NonNullable<CompositionNote['slotSemantics']> = [];
  for (const item of answer.slotSemantics ?? []) {
    if (!known.has(item.slotId) || seen.has(item.slotId) || !SEMANTIC_ROLES.has(item.role))
      continue;
    seen.add(item.slotId);
    const groupId =
      item.groupId && members.get(item.groupId)?.has(item.slotId) ? item.groupId : undefined;
    slotSemantics.push({
      slotId: item.slotId,
      role: item.role,
      ...(groupId ? { groupId } : {}),
    });
    if (slotSemantics.length === 200) break;
  }
  return {
    ...(slotSemantics.length > 0 ? { slotSemantics } : {}),
    ...(groups.length > 0 ? { groups } : {}),
  };
}

export function settleNote(
  answer: AnswerNote,
  pattern: Pattern,
  inSpecialGroup = false,
): CompositionNote {
  const reference = answer.kind === 'reference';
  const blocks = writerSlots(pattern).filter((slot) => slot.role !== 'title').length;
  const single = ['cover', 'section', 'statement'].includes(answer.kind);
  const { slotSemantics: _semantics, groups: _groups, ...rest } = answer;
  return {
    ...rest,
    title: answer.title.replace(/\s+/g, ' ').trim(),
    items: single ? 1 : Math.min(answer.items, Math.max(blocks, 1)),
    skip: reference,
    special:
      !reference &&
      (answer.special ||
        inSpecialGroup ||
        declaredQrSlots(pattern, { ...answer, skip: false }).length > 0),
    qrSlotIds: reference ? [] : declaredQrSlots(pattern, { ...answer, skip: false }),
    requiredContent: reference
      ? []
      : [...new Set(answer.requiredContent)].filter(
          (item) =>
            item !== 'image' ||
            !declaredQrSlots(pattern, { ...answer, skip: false }).length ||
            (pattern.imageSlots ?? []).some(
              (slot) => !declaredQrSlots(pattern, { ...answer, skip: false }).includes(slot.slotId),
            ),
        ),
    ...settledSemantics(answer, pattern),
  };
}

/** Kinds that open or close a part of a deck, or show people: a group of their own. */
const FRAMING_KINDS = new Set<AnswerNote['kind']>(['cover', 'section', 'team', 'closing']);

/**
 * Notes in template order. Catalog templates group their sample slides under headings; a heading
 * the indexer marked special ("code", "device mockups") makes its group special up to the next
 * reference page, because the slides themselves often carry ordinary sample text around a
 * screenshot frame or a pictured chart. A small model sees the heading far more reliably than it
 * carries it over to the slides after it.
 */
export function settleNotes(
  catalog: readonly Pattern[],
  answers: ReadonlyMap<string, AnswerNote>,
): CompositionNote[] {
  let specialGroup = false;
  return catalog.flatMap((pattern) => {
    const answer = answers.get(pattern.patternId);
    if (!answer) return [];
    if (answer.kind === 'reference') specialGroup = answer.special;
    // A cover, a section break, people or a closing slide is never a screenshot frame or a
    // pictured chart: it starts another group when the heading before it was missed.
    else if (FRAMING_KINDS.has(answer.kind)) specialGroup = false;
    return [settleNote(answer, pattern, specialGroup)];
  });
}

/**
 * Reads what each composition of a template is for, once, when the template is prepared.
 *
 * The planner then chooses by meaning ("four steps", "problem and solution") instead of guessing
 * from prompts such as "Образец текста", and never picks a page that documents the template
 * itself. The indexer describes; it does not change a single shape of the template.
 *
 * A note the model got wrong or left out does not cost the others: the valid ones are kept and
 * the model is asked again about the rest. What stays undescribed after that goes to the planner
 * without a note, as before indexing.
 */
export async function indexTemplate(options: {
  provider: TextProvider;
  instructions: string;
  profile: GenerationProfile;
  signal: AbortSignal;
  /** How many compositions have a note so far, of how many: after every answer. */
  onProgress?: (progress: IndexProgress) => void;
}): Promise<CompositionNote[]> {
  const catalog = distinctCompositions(options.profile.compositions);
  const notes = new Map<string, AnswerNote>();
  const stop = new AbortController();
  const signal = AbortSignal.any([options.signal, stop.signal]);
  let lastError: unknown;
  const report = () => options.onProgress?.({ described: notes.size, total: catalog.length });
  report();
  const ask = async (batch: Pattern[]) => {
    const ids = batch.map((pattern) => pattern.patternId) as [string, ...string[]];
    const schema = z.object({
      // One malformed note is dropped rather than failing the notes around it.
      notes: z.array(
        answerNoteSchema
          .extend({ patternId: z.enum(ids) })
          .nullable()
          .catch(null),
      ),
    });
    const answer = await options.provider.generate(
      'indexer',
      options.instructions,
      {
        compositions: batch.map((pattern) => ({
          // Neighbouring slides of a template usually belong to one group.
          slide: pattern.sourceIndex + 1,
          ...plannerComposition(pattern),
          qrCandidates: [
            ...new Map(
              [...(pattern.imageSlots ?? []), ...(pattern.qrCandidateSlots ?? [])].map((slot) => [
                slot.slotId,
                { slotId: slot.slotId, kind: slot.kind },
              ]),
            ).values(),
          ],
          // The planner brief omits slot ids. The indexer needs them to name roles.
          slots: slotBriefs(writerSlots(pattern)).map((slot) => ({
            slotId: slot.slotId,
            role: slot.role,
            sample: slot.sample.replace(/\s+/g, ' ').trim().slice(0, 60),
            ...(slot.prompt ? { prompt: true as const } : {}),
            fitChars: slot.fitChars,
            row: slot.row,
            column: slot.column,
          })),
        })),
      },
      schema,
      signal,
    );
    return answer.notes.filter((note) => note !== null);
  };
  let missing = catalog;
  const describe = async (batch: Pattern[]) => {
    signal.throwIfAborted();
    try {
      const answers = await ask(batch);
      signal.throwIfAborted();
      for (const answer of answers)
        if (!notes.has(answer.patternId)) notes.set(answer.patternId, answer);
      report();
    } catch (error) {
      signal.throwIfAborted();
      // The provider has already negotiated parameters and retried temporary HTTP failures.
      // An outer indexing round must not multiply those failures across the whole template.
      if (error instanceof ModelRequestError || options.signal.aborted) {
        stop.abort(error);
        throw error;
      }
      // One request that ran out of time or lost its connection costs only its batch: the
      // preparation has no 5-minute budget, and the next round asks again in smaller batches.
      lastError = error;
    }
  };
  for (let round = 0; round < ROUNDS && missing.length > 0; round++) {
    const batches: Pattern[][] = [];
    const size = Math.max(2, Math.ceil(BATCH / 2 ** round));
    for (let start = 0; start < missing.length; start += size)
      batches.push(missing.slice(start, start + size));
    // Parameter negotiation on one batch precedes fan-out. Parse failures may be revisited;
    // connection/model refusals stop the preparation and cancel queued/in-flight work.
    const first = batches.shift();
    if (first) await describe(first);
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(INDEX_WORKERS, batches.length) }, async () => {
        for (;;) {
          signal.throwIfAborted();
          const batch = batches[cursor++];
          if (!batch) return;
          await describe(batch);
        }
      }),
    );
    signal.throwIfAborted();
    missing = catalog.filter((pattern) => !notes.has(pattern.patternId));
  }
  if (notes.size === 0)
    throw lastError ?? new Error('The template indexer described no composition.');
  return settleNotes(catalog, notes);
}

/** Loads the indexer from the registry and indexes the template, recording its revision. */
export async function indexTemplateWithAgent(options: {
  provider: TextProvider;
  registryDir: string;
  profile: GenerationProfile;
  signal: AbortSignal;
  onProgress?: (progress: IndexProgress) => void;
}): Promise<StoredTemplateIndex> {
  const agent = await loadAgent(join(options.registryDir, 'template-indexer'));
  options.provider.setAgentGeneration?.('indexer', agent.config.generation);
  const notes = await indexTemplate({
    provider: options.provider,
    instructions: agent.instructions,
    profile: options.profile,
    signal: options.signal,
    onProgress: options.onProgress,
  });
  return {
    templateHash: options.profile.templateHash,
    profileHash: dependencyKey(options.profile),
    revision: templateIndexRevision(agent.config.version, agent.instructions),
    notes,
  };
}

/** A parseable empty or partial index is not ready; measured profile changes invalidate notes. */
export function templateIndexState(
  profile: GenerationProfile,
  index: unknown,
  revision: string,
): 'missing' | 'partial' | 'stale' | 'ready' {
  const stored = storedTemplateIndexSchema.safeParse(index);
  if (!stored.success || stored.data.notes.length === 0) return 'missing';
  if (
    stored.data.templateHash !== profile.templateHash ||
    stored.data.revision !== revision ||
    stored.data.profileHash !== dependencyKey(profile)
  )
    return 'stale';
  const expected = distinctCompositions(profile.compositions).map(
    (composition) => composition.patternId,
  );
  const ids = new Set(stored.data.notes.map((note) => note.patternId));
  return ids.size === expected.length && expected.every((id) => ids.has(id)) ? 'ready' : 'partial';
}

/** The revision an index made now would carry: compare it with a stored one before re-indexing. */
export async function currentTemplateIndexRevision(registryDir: string): Promise<string> {
  const agent = await loadAgent(join(registryDir, 'template-indexer'));
  return templateIndexRevision(agent.config.version, agent.instructions);
}

/** A new indexer version or instruction text makes a stored index stale. */
export function templateIndexRevision(version: string, instructions: string): string {
  const hash = createHash('sha256').update(instructions).digest('hex').slice(0, 12);
  return `${version}+${hash}`;
}
