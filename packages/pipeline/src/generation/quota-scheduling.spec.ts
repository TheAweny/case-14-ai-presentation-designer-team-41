import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestLimiter, retryDelay } from './provider.js';

afterEach(() => vi.useRealTimers());
describe('quota scheduling across builds and chat', () => {
  it('gives chat a turn between two busy builds without raising concurrency', async () => {
    const pool = new RequestLimiter(1);
    const signal = new AbortController().signal;
    let release = await pool.acquire(signal, 'build-a');
    const order: string[] = [];
    const completions: (() => void)[] = [];
    const queued = ['build-a', 'build-b', 'chat', 'build-a', 'build-b'].map(async (group) => {
      const done = await pool.acquire(signal, group);
      order.push(group);
      completions.push(done);
    });
    release();
    for (let index = 0; index < 5; index++) {
      await Promise.resolve();
      await Promise.resolve();
      release =
        completions.shift() ??
        (() => {
          throw new Error('No slot granted');
        });
      release();
    }
    await Promise.all(queued);
    expect(order.slice(0, 3)).toEqual(['build-b', 'chat', 'build-a']);
    expect(pool.capacity).toBe(1);
  });
  it('honors RPM/TPM windows and cancellation while waiting for quota', async () => {
    vi.useFakeTimers();
    const pool = new RequestLimiter(2, { rpm: 2, tpm: 10 });
    const signal = new AbortController().signal;
    (await pool.acquire(signal, 'a', 6))();
    const second = vi.fn();
    const pending = pool.acquire(signal, 'b', 5).then((release) => {
      second();
      release();
    });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(second).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(second).toHaveBeenCalledOnce();
    const controller = new AbortController();
    const blocked = pool.acquire(controller.signal, 'chat', 10);
    const failure = expect(blocked).rejects.toThrow('cancelled');
    controller.abort(new Error('cancelled'));
    await failure;
  });
  it('never retries earlier than a long Retry-After; caller deadline bounds the wait', () => {
    expect(retryDelay(0, '600', () => 0)).toBe(600_000);
  });
});
