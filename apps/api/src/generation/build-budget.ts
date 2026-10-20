/**
 * Wall-clock bound of one build, measured after material preparation in GenerationService.start.
 * 290_000 ms is the existing per-run ceiling. It is not a measured five-minute SLA, and it is
 * not the retry cap of 110.
 */
export const BUILD_DEADLINE_MS = 290_000;

/** Largest delay AbortSignal.timeout accepts. */
const TIMEOUT_MAX_MS = 4_294_967_295;

/** The build clock ran out before a run was started. */
export class BuildDeadlineError extends Error {
  override readonly name = 'BuildDeadlineError';

  constructor() {
    super('Build deadline passed before the run could start.');
  }
}

export interface BuildBudget {
  readonly startedAt: number;
  readonly deadlineAt: number;
  /** Cancellation and the absolute deadline. Aborted means the current phase must stop. */
  readonly signal: AbortSignal;
  /** Clears the deadline timer and both abort listeners. Idempotent. */
  dispose(): void;
}

/** Preparation is outside the generation ceiling; Stop and shutdown still gate late reads. */
export function openPreparation(cancel: AbortSignal, now: number): BuildBudget {
  return {
    startedAt: now,
    deadlineAt: Number.POSITIVE_INFINITY,
    signal: cancel,
    dispose() {
      return undefined;
    },
  };
}

function assertEpochMs(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer epoch millisecond timestamp.`);
  }
}

/**
 * Milliseconds left until the absolute deadline. Zero means it has already passed.
 * The result is an integer in the range AbortSignal.timeout accepts.
 */
export function remainingBuildMs(
  startedAt: number,
  now = Date.now(),
  deadlineMs = BUILD_DEADLINE_MS,
): number {
  assertEpochMs(startedAt, 'Build start time');
  assertEpochMs(now, 'Clock time');
  if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > TIMEOUT_MAX_MS) {
    throw new Error('Build deadline must be an integer of milliseconds from 1 through 4294967295.');
  }
  const left = deadlineMs - (now - startedAt);
  if (left <= 0) return 0;
  const delay = Math.floor(left);
  if (delay > TIMEOUT_MAX_MS) {
    throw new Error('Build deadline delay exceeds the timer range.');
  }
  return delay;
}

/**
 * Opens the build clock. `startedAt` is taken after material preparation and before model resolution.
 * `cancel` is the build's own cancellation, the same controller later stored on its runs.
 */
export function openBuildBudget(
  startedAt: number,
  cancel: AbortSignal,
  deadlineMs = BUILD_DEADLINE_MS,
  now = startedAt,
): BuildBudget {
  const left = remainingBuildMs(startedAt, now, deadlineMs);
  const deadlineAt = startedAt + deadlineMs;
  const deadline = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopTimer = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };
  // An already aborted cancel, or no time left, must not leave a timer behind.
  if (left === 0) {
    deadline.abort(new BuildDeadlineError());
  } else if (!cancel.aborted) {
    timer = setTimeout(() => deadline.abort(new BuildDeadlineError()), left);
    timer.unref();
    cancel.addEventListener('abort', stopTimer, { once: true });
    deadline.signal.addEventListener('abort', stopTimer, { once: true });
  }
  const signal = AbortSignal.any([cancel, deadline.signal]);
  let disposed = false;
  return {
    startedAt,
    deadlineAt,
    signal,
    dispose() {
      if (disposed) return;
      disposed = true;
      stopTimer();
      cancel.removeEventListener('abort', stopTimer);
      deadline.signal.removeEventListener('abort', stopTimer);
    },
  };
}

/** Error to throw once the build signal has aborted. Timeout becomes BuildDeadlineError. */
export function buildStopReason(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof BuildDeadlineError) return reason;
  if (reason instanceof Error && reason.name === 'TimeoutError') return new BuildDeadlineError();
  if (reason instanceof Error) return reason;
  return new BuildDeadlineError();
}

/**
 * Starts `work` only while the budget is still open, then resolves with it or rejects when the
 * budget signal aborts, whichever is first. A result that arrives after the stop is ignored, so
 * a query or model call that never watches the signal cannot continue into run creation.
 * The factory is not called after abort, so the work itself is not started.
 */
export function waitForBuild<T>(work: () => Promise<T>, budget: BuildBudget): Promise<T> {
  if (budget.signal.aborted) return Promise.reject(buildStopReason(budget.signal));
  let pending: Promise<T>;
  try {
    pending = work();
  } catch (error) {
    return Promise.reject(error);
  }
  void pending.catch(() => undefined);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      budget.signal.removeEventListener('abort', onAbort);
      settle();
    };
    const onAbort = () => finish(() => reject(buildStopReason(budget.signal)));
    budget.signal.addEventListener('abort', onAbort, { once: true });
    if (budget.signal.aborted) onAbort();
    void pending.then(
      (value) =>
        finish(() => {
          if (budget.signal.aborted) reject(buildStopReason(budget.signal));
          else resolve(value);
        }),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}
