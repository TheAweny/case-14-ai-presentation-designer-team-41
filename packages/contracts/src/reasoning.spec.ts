import { describe, expect, it } from 'vitest';
import { modelCapabilitiesSchema, NO_REASONING_CHOICE } from './reasoning.js';

describe('model capabilities', () => {
  it('accepts what a probe can find', () => {
    for (const reasoning of [
      { toggle: 'enable-thinking', levels: false },
      { toggle: 'reasoning-effort', levels: true },
      { toggle: null, levels: true },
      NO_REASONING_CHOICE,
    ]) {
      expect(modelCapabilitiesSchema.parse({ reasoning, probed: true }).reasoning).toEqual(
        reasoning,
      );
    }
  });

  it('refuses a switch the API does not know how to send', () => {
    expect(
      modelCapabilitiesSchema.safeParse({
        reasoning: { toggle: 'thinking-budget', levels: false },
        probed: true,
      }).success,
    ).toBe(false);
  });
});
