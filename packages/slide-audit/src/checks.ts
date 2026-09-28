import registry from './checks.json' with { type: 'json' };
import type { AuditLevel } from './types.js';

/**
 * The checks this package runs, with what each looks at. The editor and the pipeline run the same
 * list, so a slide that passes in the editor passes after generation too.
 *
 * Titles and descriptions live in JSON next to this file because `docs/AUDIT.md` is generated
 * from it by the Python tooling, as it is from the contextual registry of `packages/pipeline`.
 */

export const CHECK_IDS = [
  'text-overflow',
  'element-overlap',
  'off-slide',
  'safe-margins',
  'placeholder-text',
  'contrast',
  'font-unavailable',
] as const;

export type CheckId = (typeof CHECK_IDS)[number];

export interface CheckDefinition {
  readonly id: CheckId;
  readonly title: string;
  readonly description: string;
  /** The gravest level the check raises. Most checks raise the other one too, by kind. */
  readonly severity: AuditLevel;
}

export const CHECKS: readonly CheckDefinition[] = registry.checks as readonly CheckDefinition[];
