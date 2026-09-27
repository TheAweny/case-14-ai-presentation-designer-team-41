import { deckPlanSchema, slideIntentSchema, type ContentPack, type DeckPlan } from '@lct/contracts';
import type { LoadedAgent } from '@lct/registry';
import { z } from 'zod';
import { runAgent, type ModelProvider } from '../models/provider.js';
import { checkGrounding, repairSources, type GroundingProblem } from './grounding.js';

export interface PlanDeckOptions {
  readonly pack: ContentPack;
  readonly slideCount: number;
  readonly agent: LoadedAgent;
  readonly provider: ModelProvider;
  readonly seed: number;
}

export interface PlanDeckResult {
  readonly plan: DeckPlan;
  /** What the pack still does not back after the repair round. Empty for a grounded plan. */
  readonly problems: readonly GroundingProblem[];
  /** Model calls it took, one or two. */
  readonly calls: number;
}

/** The DeckPlan schema as JSON Schema, handed to the model so it knows the exact shape. */
const PLAN_SCHEMA = z.toJSONSchema(deckPlanSchema, { io: 'input', unrepresentable: 'any' });

/**
 * Builds the one plan every layout variant is made from.
 *
 * The planner agent gets the pack, the slide count and the shape it must answer in. Its answer is
 * checked against the pack deterministically: a figure the user never gave, a quote that is not
 * in its source, a wrong number of slides. Anything found goes back to the model once, as a list
 * of problems to fix; what survives that round is returned with the plan, for the audit to show.
 */
export async function planDeck(options: PlanDeckOptions): Promise<PlanDeckResult> {
  const { pack, slideCount, agent, provider, seed } = options;
  const input = {
    task: 'plan-deck',
    slideCount,
    briefId: pack.briefId,
    language: pack.language,
    goal: pack.goal,
    audience: pack.audience,
    intents: slideIntentSchema.options,
    items: pack.items.map(({ itemId, kind, title, text }) => ({ itemId, kind, title, text })),
    outputSchema: PLAN_SCHEMA,
  };
  let plan = repairSources(await runAgent<DeckPlan>(provider, { agent, input, seed }), pack).plan;
  let problems = checkGrounding(plan, pack, slideCount);
  if (problems.length === 0) {
    return { plan, problems, calls: 1 };
  }
  const repair = { ...input, previousPlan: plan, problems: problems.map(describe) };
  plan = repairSources(
    await runAgent<DeckPlan>(provider, { agent, input: repair, seed }),
    pack,
  ).plan;
  problems = checkGrounding(plan, pack, slideCount);
  return { plan, problems, calls: 2 };
}

function describe(problem: GroundingProblem): string {
  return problem.slideId === null ? problem.message : `${problem.slideId}: ${problem.message}`;
}
