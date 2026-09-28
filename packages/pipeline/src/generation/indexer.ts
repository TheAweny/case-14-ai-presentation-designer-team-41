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
import { distinctCompositions, plannerComposition } from './workflow.js';

/** Compositions per model call: small enough that one answer never runs out of tokens. */
const BATCH = 12;

/**
 * Reads what each composition of a template is for, once, when the template is prepared.
 *
 * The planner then chooses by meaning ("four steps", "problem and solution") instead of guessing
 * from prompts such as "Образец текста", and never picks a page that documents the template
 * itself. The indexer describes; it does not change a single shape of the template.
 */
export async function indexTemplate(options: {
  provider: TextProvider;
  instructions: string;
  profile: GenerationProfile;
  signal: AbortSignal;
}): Promise<CompositionNote[]> {
  const catalog = distinctCompositions(options.profile.compositions);
  const batches: (typeof catalog)[] = [];
  for (let start = 0; start < catalog.length; start += BATCH)
    batches.push(catalog.slice(start, start + BATCH));
  const answers = await Promise.all(
    batches.map((batch) => {
      const ids = batch.map((pattern) => pattern.patternId) as [string, ...string[]];
      const schema = z.object({
        notes: z.array(compositionNoteSchema.extend({ patternId: z.enum(ids) })),
      });
      return options.provider.generate(
        'indexer',
        options.instructions,
        { compositions: batch.map((pattern) => plannerComposition(pattern)) },
        schema,
        options.signal,
      );
    }),
  );
  const seen = new Set<string>();
  return answers
    .flatMap((answer) => answer.notes)
    .filter((note) => !seen.has(note.patternId) && seen.add(note.patternId));
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
