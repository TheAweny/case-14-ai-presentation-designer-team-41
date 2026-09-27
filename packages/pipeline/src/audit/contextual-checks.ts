import registry from './contextual-checks.json' with { type: 'json' };

/** One contextual check: a judgement that needs to read the meaning of a slide. */
export interface ContextualCheck {
  readonly id: string;
  readonly title: string;
  /** The content validation question of the case, phrased so that "yes" is the good answer. */
  readonly question: string;
  readonly description: string;
  readonly severity: 'error' | 'warning';
  readonly scope: 'slide';
}

/**
 * Contextual half of the audit. The list lives in JSON next to this file because
 * `docs/AUDIT.md` is generated from both registries — this one and the deterministic one
 * inside the Python engine.
 */
export const CONTEXTUAL_CHECKS: readonly ContextualCheck[] =
  registry.checks as readonly ContextualCheck[];

/** Ids of the contextual checks, for cross-checking against `configs/audit.yaml`. */
export const CONTEXTUAL_CHECK_IDS: readonly string[] = CONTEXTUAL_CHECKS.map((check) => check.id);
