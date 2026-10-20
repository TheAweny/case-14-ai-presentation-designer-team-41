/** Separate web quotas for one chat turn. A cache hit spends nothing. */

export const WEB_BUDGET = {
  search: 8,
  fetch: 24,
  images: 4,
  research: 4,
  total: 36,
} as const;

export type WebBudgetOperation = 'search' | 'fetch' | 'images' | 'research';

export interface WebBudgetSnapshot {
  readonly used: number;
  readonly limit: number;
  readonly operation: WebBudgetOperation;
  readonly operationUsed: number;
  readonly operationLimit: number;
  readonly totalUsed: number;
  readonly totalLimit: number;
}

/** The model can keep going with the other operations and results already stored. */
export class WebBudgetError extends Error {
  override readonly name = 'WebBudgetError';
  readonly code = 'web_budget_exhausted' as const;
  readonly canContinue = true as const;

  constructor(readonly snapshot: WebBudgetSnapshot) {
    super(
      'The ' +
        snapshot.operation +
        ' budget for this turn is exhausted (' +
        String(snapshot.used) +
        '/' +
        String(snapshot.limit) +
        ').',
    );
  }
}

export function webBudgetOutput(error: WebBudgetError): {
  code: 'web_budget_exhausted';
  error: string;
  used: number;
  limit: number;
  operation: WebBudgetOperation;
  operationUsed: number;
  operationLimit: number;
  totalUsed: number;
  totalLimit: number;
  canContinue: true;
} {
  return {
    code: error.code,
    error: error.message,
    used: error.snapshot.used,
    limit: error.snapshot.limit,
    operation: error.snapshot.operation,
    operationUsed: error.snapshot.operationUsed,
    operationLimit: error.snapshot.operationLimit,
    totalUsed: error.snapshot.totalUsed,
    totalLimit: error.snapshot.totalLimit,
    canContinue: true,
  };
}

/**
 * Counts new search, fetch and image calls for one chat turn. Callers of one turn share one abort
 * signal. A successful result is cached and a later identical key spends nothing. A failure is
 * counted and not cached. Identical keys already running share one load.
 */
export class WebBudget {
  private readonly used = { search: 0, fetch: 0, images: 0 };
  private totalUsed = 0;
  private readonly cache = new Map<string, unknown>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  remaining(researchUsed = 0): Record<string, number> {
    return {
      search: Math.max(0, WEB_BUDGET.search - this.used.search),
      fetch: Math.max(0, WEB_BUDGET.fetch - this.used.fetch),
      images: Math.max(0, WEB_BUDGET.images - this.used.images),
      research: Math.max(0, WEB_BUDGET.research - researchUsed),
      total: Math.max(0, WEB_BUDGET.total - this.totalUsed),
    };
  }

  async call<T>(
    operation: Exclude<WebBudgetOperation, 'research'>,
    key: string,
    signal: AbortSignal,
    load: () => Promise<T>,
  ): Promise<T> {
    throwIfAborted(signal);
    const cacheKey = operation + ':' + key;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached as T;

    const running = this.inflight.get(cacheKey);
    if (running) {
      const shared = (await running) as T;
      throwIfAborted(signal);
      return shared;
    }

    this.reserve(operation);
    const promise = Promise.resolve()
      .then(load)
      .then((output) => {
        throwIfAborted(signal);
        this.cache.set(cacheKey, output);
        return output;
      });
    this.inflight.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(cacheKey);
    }
  }

  /** Research questions are a separate counter. The search and pages inside them use call(). */
  reserveResearch(used: number): void {
    if (used >= WEB_BUDGET.research) {
      throw new WebBudgetError({
        used,
        limit: WEB_BUDGET.research,
        operation: 'research',
        operationUsed: used,
        operationLimit: WEB_BUDGET.research,
        totalUsed: this.totalUsed,
        totalLimit: WEB_BUDGET.total,
      });
    }
  }

  private reserve(operation: Exclude<WebBudgetOperation, 'research'>): void {
    const operationUsed = this.used[operation];
    const operationLimit = WEB_BUDGET[operation];
    if (operationUsed >= operationLimit || this.totalUsed >= WEB_BUDGET.total) {
      const total = this.totalUsed >= WEB_BUDGET.total && operationUsed < operationLimit;
      throw new WebBudgetError({
        used: total ? this.totalUsed : operationUsed,
        limit: total ? WEB_BUDGET.total : operationLimit,
        operation,
        operationUsed,
        operationLimit,
        totalUsed: this.totalUsed,
        totalLimit: WEB_BUDGET.total,
      });
    }
    this.used[operation] += 1;
    this.totalUsed += 1;
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const reason: unknown = signal.reason;
  throw reason instanceof Error ? reason : new Error('This operation was aborted.');
}
