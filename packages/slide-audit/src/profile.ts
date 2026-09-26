import defaults from './default-profile.json' with { type: 'json' };
import type { AuditProfile } from './types.js';

/**
 * The `default` profile of `configs/audit.yaml`. It is JSON rather than code because the filler
 * strings the audit looks for must not appear in source, where the same audit would flag them.
 */
export const DEFAULT_AUDIT_PROFILE: AuditProfile = defaults;

export function profileOf(overrides: Partial<AuditProfile> | undefined): AuditProfile {
  return { ...DEFAULT_AUDIT_PROFILE, ...overrides };
}
