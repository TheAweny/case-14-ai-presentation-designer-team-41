import type { ReasoningEffort } from '@lct/contracts';

export type ModelPlanSource = 'role-setting' | 'explicit-action' | 'writer-fallback';

export interface ModelPlanIdentity {
  readonly modelId: string;
  readonly connectionId: string;
}

export interface EffectiveModelRole extends ModelPlanIdentity {
  readonly role: 'writer' | 'rewriter' | 'planner' | 'critic' | 'vision';
  readonly source: ModelPlanSource;
}

/**
 * What this build will call. Secrets stay out. Thinking and reasoning effort are copied from the
 * request only when the request set them. The attempt cap is a retry count, not a measured SLA.
 */
export interface EffectiveModelPlan {
  readonly schemaVersion: 1;
  readonly startedAt: number;
  readonly deadlineAt: number | null;
  readonly attemptBudgetMax: number;
  readonly requestedThinking?: boolean;
  readonly requestedReasoningEffort?: ReasoningEffort;
  readonly roles: readonly EffectiveModelRole[];
}

function identity(model: ModelPlanIdentity): ModelPlanIdentity {
  return { modelId: model.modelId, connectionId: model.connectionId };
}

export function effectiveModelPlan(input: {
  readonly startedAt: number;
  readonly deadlineAt: number;
  readonly attemptBudgetMax: number;
  readonly thinking: boolean | null;
  readonly reasoningEffort: ReasoningEffort | null;
  readonly writerExplicit: boolean;
  readonly writer: ModelPlanIdentity;
  readonly planner: ModelPlanIdentity | null;
  readonly critic: ModelPlanIdentity | null;
  readonly vision: ModelPlanIdentity | null;
}): EffectiveModelPlan {
  const writer = identity(input.writer);
  const follow = (
    role: 'planner' | 'critic',
    assigned: ModelPlanIdentity | null,
  ): EffectiveModelRole =>
    assigned
      ? { role, ...identity(assigned), source: 'role-setting' }
      : { role, ...writer, source: 'writer-fallback' };
  const roles: EffectiveModelRole[] = [
    {
      role: 'writer',
      ...writer,
      source: input.writerExplicit ? 'explicit-action' : 'role-setting',
    },
    { role: 'rewriter', ...writer, source: 'writer-fallback' },
    follow('planner', input.planner),
    follow('critic', input.critic),
  ];
  if (input.vision) {
    roles.push({ role: 'vision', ...identity(input.vision), source: 'role-setting' });
  }
  return {
    schemaVersion: 1,
    startedAt: input.startedAt,
    deadlineAt: Number.isFinite(input.deadlineAt) ? input.deadlineAt : null,
    attemptBudgetMax: input.attemptBudgetMax,
    ...(typeof input.thinking === 'boolean' ? { requestedThinking: input.thinking } : {}),
    ...(input.reasoningEffort !== null ? { requestedReasoningEffort: input.reasoningEffort } : {}),
    roles,
  };
}
