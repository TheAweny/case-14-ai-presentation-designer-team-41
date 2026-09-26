import { describe, expect, it } from 'vitest';
import { NUDGE_SERIES_MS, nextNudgeSeries } from './nudge-series';

describe('nudge series', () => {
  it('keeps one key while the same objects move without a pause', () => {
    const first = nextNudgeSeries(null, 's1', ['a', 'b'], 1000);
    const second = nextNudgeSeries(first, 's1', ['b', 'a'], 1000 + NUDGE_SERIES_MS);
    const third = nextNudgeSeries(second, 's1', ['a', 'b'], 1000 + NUDGE_SERIES_MS * 2);
    expect(second.key).toBe(first.key);
    expect(third.key).toBe(first.key);
  });

  it('starts a new series after a pause', () => {
    const first = nextNudgeSeries(null, 's1', ['a'], 1000);
    const later = nextNudgeSeries(first, 's1', ['a'], 1001 + NUDGE_SERIES_MS);
    expect(later.key).not.toBe(first.key);
  });

  it('starts a new series for other objects or another slide', () => {
    const first = nextNudgeSeries(null, 's1', ['a'], 1000);
    expect(nextNudgeSeries(first, 's1', ['a', 'b'], 1100).key).not.toBe(first.key);
    expect(nextNudgeSeries(first, 's2', ['a'], 1100).key).not.toBe(first.key);
  });
});
