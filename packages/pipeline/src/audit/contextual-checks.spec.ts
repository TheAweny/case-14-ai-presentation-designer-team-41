import { describe, expect, it } from 'vitest';
import { CONTEXTUAL_CHECKS, CONTEXTUAL_CHECK_IDS } from './contextual-checks.js';

describe('contextual check registry', () => {
  it('declares every check with an id, a title and a severity', () => {
    for (const check of CONTEXTUAL_CHECKS) {
      expect(check.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(check.title.length).toBeGreaterThan(0);
      expect(check.description.length).toBeGreaterThan(0);
      expect(['error', 'warning']).toContain(check.severity);
    }
  });

  it('keeps check ids unique', () => {
    expect(new Set(CONTEXTUAL_CHECK_IDS).size).toBe(CONTEXTUAL_CHECK_IDS.length);
  });
});
