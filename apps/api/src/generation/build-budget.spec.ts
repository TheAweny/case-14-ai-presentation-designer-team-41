import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BuildDeadlineError,
  openBuildBudget,
  remainingBuildMs,
  waitForBuild,
} from './build-budget.js';

describe('build budget', () => {
  it('disables the clock with zero while retaining Stop cancellation', async () => {
    vi.useFakeTimers();
    const cancel = new AbortController();
    const budget = openBuildBudget(1000, cancel.signal, 0, 1000);
    expect(budget.deadlineAt).toBe(Number.POSITIVE_INFINITY);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(budget.signal.aborted).toBe(false);
    const pending = waitForBuild(() => new Promise<never>(() => undefined), budget);
    cancel.abort(new Error('user stop'));
    await expect(pending).rejects.toThrow('user stop');
    budget.dispose();
  });
  const leaks: unknown[] = [];
  const onLeak = (error: unknown) => {
    leaks.push(error);
  };

  afterEach(() => {
    process.off('unhandledRejection', onLeak);
    leaks.length = 0;
    vi.useRealTimers();
  });

  it('accepts only an integer timestamp and an integer timeout delay', () => {
    expect(remainingBuildMs(1_000, 1_000, 290_000)).toBe(290_000);
    expect(remainingBuildMs(1_000, 1_040, 290_000)).toBe(289_960);
    expect(Number.isInteger(remainingBuildMs(1_000, 1_040, 290_000))).toBe(true);
    expect(remainingBuildMs(1_000, 291_000, 290_000)).toBe(0);
    expect(() => remainingBuildMs(1.5, 2, 290_000)).toThrow(/integer epoch/);
    expect(() => remainingBuildMs(1_000, 1.5, 290_000)).toThrow(/integer epoch/);
    expect(() => remainingBuildMs(1_000, 1_000, 1.5)).toThrow(/4294967295/);
    expect(() => openBuildBudget(10.2, new AbortController().signal)).toThrow(/integer epoch/);
  });

  it('does not start work after the deadline', async () => {
    const startedAt = 5_000;
    const budget = openBuildBudget(startedAt, new AbortController().signal, 20, startedAt + 20);
    let started = false;
    await expect(
      waitForBuild(() => {
        started = true;
        return Promise.reject(new Error('should not start'));
      }, budget),
    ).rejects.toBeInstanceOf(BuildDeadlineError);
    expect(started).toBe(false);
    expect(budget.signal.aborted).toBe(true);
  });

  it('drops a late rejection without an unhandled rejection', async () => {
    process.on('unhandledRejection', onLeak);
    const startedAt = Date.now();
    const budget = openBuildBudget(startedAt, new AbortController().signal, 25, startedAt);
    let rejectWork: (error: Error) => void = () => undefined;
    const pending = waitForBuild(
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectWork = reject;
        }),
      budget,
    );
    await expect(pending).rejects.toBeInstanceOf(BuildDeadlineError);
    rejectWork(new Error('late failure'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(leaks).toEqual([]);
  });

  it('rejects when the factory aborts before the listener is attached', async () => {
    const control = new AbortController();
    const startedAt = Date.now();
    const budget = openBuildBudget(startedAt, control.signal, 60_000, startedAt);
    const pending = waitForBuild(() => {
      control.abort(new Error('sync cancel'));
      return new Promise<never>(() => undefined);
    }, budget);
    const probe = new Promise((resolve) =>
      setTimeout(() => resolve('still-pending-after-cancel'), 20),
    );
    const result = await Promise.race([
      pending.then(
        () => 'resolved',
        (error: unknown) => error,
      ),
      probe,
    ]);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe('sync cancel');
  });

  it('dispose clears the deadline timer and can be called twice', async () => {
    vi.useFakeTimers();
    const startedAt = 1_000;
    const budget = openBuildBudget(startedAt, new AbortController().signal, 50_000, startedAt);
    expect(vi.getTimerCount()).toBe(1);
    budget.dispose();
    budget.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(50_000);
    expect(budget.signal.aborted).toBe(false);
  });

  it('arms no timer when cancellation is already aborted', () => {
    vi.useFakeTimers();
    const cancel = new AbortController();
    cancel.abort(new Error('already'));
    const startedAt = 1_000;
    const budget = openBuildBudget(startedAt, cancel.signal, 290_000, startedAt);
    expect(vi.getTimerCount()).toBe(0);
    expect(budget.signal.aborted).toBe(true);
    budget.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
