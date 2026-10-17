/**
 * Ceiling for retries of one build. The caller creates the instance and passes the same one
 * to every layer that sends a request again. The first request is not a retry.
 *
 * 110 is only a cap: it is not a measured five-minute budget, and a build that never passes
 * this object is not limited by it.
 */
export const DEFAULT_ATTEMPT_BUDGET = 110;

/** Counts a run log can record when a build stops or finishes. */
export interface AttemptBudgetSnapshot {
  readonly max: number;
  readonly used: number;
  readonly remaining: number;
}

/**
 * Attempts left for one build. The caller creates the instance and hands the same one to every
 * layer that retries. There is no process-wide budget.
 */
export class AttemptBudget {
  private used = 0;

  constructor(readonly max = DEFAULT_ATTEMPT_BUDGET) {
    if (!Number.isInteger(max) || max < 1) {
      throw new Error('Attempt budget must be a finite integer of at least 1.');
    }
  }

  /** Takes one attempt. Returns false once the budget is spent, and does not go below zero. */
  tryTake(): boolean {
    if (this.used >= this.max) return false;
    this.used += 1;
    return true;
  }

  get remaining(): number {
    return this.max - this.used;
  }

  snapshot(): AttemptBudgetSnapshot {
    return { max: this.max, used: this.used, remaining: this.remaining };
  }
}
