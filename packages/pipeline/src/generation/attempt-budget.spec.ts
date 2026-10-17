import { describe, expect, it } from 'vitest';
import { AttemptBudget, DEFAULT_ATTEMPT_BUDGET } from './attempt-budget.js';

describe('attempt budget', () => {
  it('starts at a finite default that covers a 10-slide build plus a reserve', () => {
    const budget = new AttemptBudget();
    expect(DEFAULT_ATTEMPT_BUDGET).toBe(110);
    expect(budget.max).toBe(110);
    expect(budget.remaining).toBe(110);
    expect(budget.snapshot()).toEqual({ max: 110, used: 0, remaining: 110 });
  });

  it('consumes one attempt per take and then refuses', () => {
    const budget = new AttemptBudget(2);
    expect(budget.tryTake()).toBe(true);
    expect(budget.remaining).toBe(1);
    expect(budget.snapshot()).toEqual({ max: 2, used: 1, remaining: 1 });
    expect(budget.tryTake()).toBe(true);
    expect(budget.tryTake()).toBe(false);
    expect(budget.tryTake()).toBe(false);
    expect(budget.remaining).toBe(0);
    expect(budget.snapshot()).toEqual({ max: 2, used: 2, remaining: 0 });
  });

  it('rejects a max that is not a finite count of at least one', () => {
    const rejected = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -3, 1.5];
    for (const max of rejected) {
      expect(() => new AttemptBudget(max)).toThrow(/finite integer of at least 1/);
    }
  });

  it('keeps each build on its own budget', () => {
    const first = new AttemptBudget(1);
    const second = new AttemptBudget(1);
    expect(first.tryTake()).toBe(true);
    expect(second.remaining).toBe(1);
    expect(second.tryTake()).toBe(true);
    expect(first.tryTake()).toBe(false);
    expect(second.snapshot()).toEqual({ max: 1, used: 1, remaining: 0 });
  });
});
