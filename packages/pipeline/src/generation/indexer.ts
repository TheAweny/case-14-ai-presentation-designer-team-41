import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { loadAgent } from '@lct/registry';
import {
  compositionNoteSchema,
  type CompositionNote,
  type GenerationProfile,
  type StoredTemplateIndex,
} from '@lct/contracts';
import { OpenAICompatibleProvider, RoutedTextProvider, type TextProvider } from './provider.js';
import { distinctCompositions, plannerComposition, writerSlots } from './workflow.js';

/** Compositions per model call: small enough that one answer never runs out of tokens. */
const BATCH = 12;
/** Calls per composition at most: the first, then asking again for what the answers left out. */
const ROUNDS = 3;

type Pattern = GenerationProfile['compositions'][number];

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
export function settleNote(
  answer: AnswerNote,
  pattern: Pattern,
  inSpecialGroup = false,
): CompositionNote {
  const reference = answer.kind === 'reference';
  const blocks = writerSlots(pattern).filter((slot) => slot.role !== 'title').length;
  const single = ['cover', 'section', 'statement'].includes(answer.kind);
  return {
    ...answer,
    title: answer.title.replace(/\s+/g, ' ').trim(),
    items: single ? 1 : Math.min(answer.items, Math.max(blocks, 1)),
    skip: reference,
    special: !reference && (answer.special || inSpecialGroup),
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
}): Promise<CompositionNote[]> {
  const catalog = distinctCompositions(options.profile.compositions);
  const notes = new Map<string, AnswerNote>();
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
        })),
      },
      schema,
      options.signal,
    );
    return answer.notes.filter((note) => note !== null);
  };
  let missing = catalog;
  for (let round = 0; round < ROUNDS && missing.length > 0; round++) {
    const batches: Pattern[][] = [];
    for (let start = 0; start < missing.length; start += BATCH)
      batches.push(missing.slice(start, start + BATCH));
    // A batch whose answer never parsed is asked again in the next round, not fatal.
    const answers = await Promise.all(batches.map((batch) => ask(batch).catch(() => [])));
    options.signal.throwIfAborted();
    for (const answer of answers.flat())
      if (!notes.has(answer.patternId)) notes.set(answer.patternId, answer);
    missing = catalog.filter((pattern) => !notes.has(pattern.patternId));
  }
  if (notes.size === 0) throw new Error('The template indexer described no composition.');
  return settleNotes(catalog, notes);
}

/** Loads the indexer from the registry and indexes the template, recording its revision. */
export async function indexTemplateWithAgent(options: {
  provider: TextProvider;
  registryDir: string;
  profile: GenerationProfile;
  signal: AbortSignal;
}): Promise<StoredTemplateIndex> {
  const agent = await loadAgent(join(options.registryDir, 'template-indexer'));
  if (
    options.provider instanceof OpenAICompatibleProvider ||
    options.provider instanceof RoutedTextProvider
  )
    options.provider.setAgentGeneration('indexer', agent.config.generation);
  const notes = await indexTemplate({
    provider: options.provider,
    instructions: agent.instructions,
    profile: options.profile,
    signal: options.signal,
  });
  return {
    templateHash: options.profile.templateHash,
    revision: templateIndexRevision(agent.config.version, agent.instructions),
    notes,
  };
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
