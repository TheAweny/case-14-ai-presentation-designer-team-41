import { describe, expect, it } from 'vitest';
import { connectionModelIds } from './model-settings.js';

describe('connection model catalog', () => {
  it('keeps explicitly enabled models without discovery and deduplicates reported ids', () => {
    expect(connectionModelIds({ lastCheck: null, enabledModels: ['personal'] })).toEqual([
      'personal',
    ]);
    expect(
      connectionModelIds({
        lastCheck: { ok: true, at: '2026-10-18T00:00:00Z', models: ['shared', 'shared'] },
        enabledModels: ['shared', 'personal'],
      }),
    ).toEqual(['shared', 'personal']);
  });

  it('offers manually classified models after discovery failed but respects an empty allowlist', () => {
    const model = {
      lastCheck: {
        ok: false as const,
        at: '2026-10-18T00:00:00Z',
        error: { kind: 'timeout' as const },
      },
      manualKinds: { voice: ['speech' as const] },
    };
    expect(connectionModelIds(model)).toEqual(['voice']);
    expect(connectionModelIds({ ...model, enabledModels: [] })).toEqual([]);
    expect(connectionModelIds({ ...model, enabledModels: ['other'] })).toEqual(['other']);
  });
});
