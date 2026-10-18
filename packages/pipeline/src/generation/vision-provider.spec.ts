import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoadedAgent } from '@lct/registry';
import type { ModelRequest } from '../models/provider.js';
import { AttemptBudget } from './attempt-budget.js';
import { RequestLimiter } from './provider.js';
import { VisionProvider, type VisionProviderOptions } from './vision-provider.js';

const agent: LoadedAgent = {
  config: {
    id: 'slide-reviewer',
    version: '1.2.0',
    description: 'Reviewer.',
    modelId: 'vision-default',
    generation: { temperature: 0, topP: 1, maxOutputTokens: 2048 },
    outputSchema: 'SlideReview',
    instructionsFile: 'instructions.md',
  },
  instructions: 'Review the slide.',
  directory: 'registry/agents/slide-reviewer',
};

const gateway = {
  apiKey: '',
  baseUrl: 'https://gateway.test/v1',
  model: 'm',
};

const answerFormat = { format: 'Schema: {{schema}}', repair: 'Fix: {{problems}}' };

function request(signal?: AbortSignal): ModelRequest {
  return {
    agent,
    input: { task: 'review-slide' },
    seed: 7,
    images: ['data:image/png;base64,AAAA'],
    responseSchema: { name: 'SlideReview', schema: { type: 'object' } },
    signal,
  };
}

function answer(content = '{}'): Response {
  return Response.json({ choices: [{ message: { content } }] });
}

function busy(): Response {
  return new Response('', { status: 429, headers: { 'retry-after': '2' } });
}

interface SlotProbe {
  limiter: RequestLimiter;
  events: string[];
  held(): number;
  queued(): number;
}

/** A queue with the same abort contract as RequestLimiter, without the process-wide pool. */
function slotProbe(capacity = 1): SlotProbe {
  let active = 0;
  const waiting: (() => void)[] = [];
  const events: string[] = [];
  const limiter = {
    async acquire(signal: AbortSignal): Promise<() => void> {
      signal.throwIfAborted();
      if (active >= capacity) {
        await new Promise<void>((resolve, reject) => {
          const grant = () => {
            signal.removeEventListener('abort', onAbort);
            resolve();
          };
          const onAbort = () => {
            const index = waiting.indexOf(grant);
            if (index >= 0) waiting.splice(index, 1);
            reject(signal.reason);
          };
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          waiting.push(grant);
          signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      signal.throwIfAborted();
      active += 1;
      events.push('acquire');
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
        events.push('release');
        waiting.shift()?.();
      };
    },
    throttle(ms: number) {
      events.push(`throttle:${ms}`);
    },
    succeeded() {
      events.push('succeeded');
    },
  };
  return {
    limiter: limiter as unknown as RequestLimiter,
    events,
    held: () => active,
    queued: () => waiting.length,
  };
}

function provider(
  options: Partial<VisionProviderOptions> & Pick<VisionProviderOptions, 'fetchImpl' | 'limiter'>,
): VisionProvider {
  return new VisionProvider({ ...gateway, ...options });
}

afterEach(() => vi.useRealTimers());

describe('VisionProvider', () => {
  it('throttles after a 429, records the success, and releases both slots', async () => {
    vi.useFakeTimers();
    const probe = slotProbe();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(busy())
      .mockResolvedValueOnce(answer());
    const pending = provider({ fetchImpl, limiter: probe.limiter }).complete(request());
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toBe('{}');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(probe.events).toEqual([
      'acquire',
      'throttle:2000',
      'release',
      'acquire',
      'succeeded',
      'release',
    ]);
    expect(probe.held()).toBe(0);
    expect(probe.queued()).toBe(0);
  });

  it('halves a real limiter on 429 and grows it back after a run of answers', async () => {
    vi.useFakeTimers();
    const limiter = new RequestLimiter(4);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(busy())
      .mockImplementation(async () => answer());
    const vision = provider({ fetchImpl, limiter });
    const pending = vision.complete(request());
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toBe('{}');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(limiter.capacity).toBe(2);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(vision.complete(request())).resolves.toBe('{}');
    }
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(limiter.capacity).toBe(4);
  });

  it('does not fetch a request aborted while it waits for a slot', async () => {
    const probe = slotProbe();
    let finish: (response: Response) => void = () => {
      throw new Error('The in-flight vision request never started.');
    };
    const signals: AbortSignal[] = [];
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const running = provider({ fetchImpl, limiter: probe.limiter }).complete(request());
    const abort = new AbortController();
    const reason = new DOMException('queued review cancelled', 'AbortError');
    const queued = provider({ fetchImpl, limiter: probe.limiter }).complete(request(abort.signal));
    const rejection = expect(queued).rejects.toBe(reason);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(probe.queued()).toBe(1);
    expect(probe.held()).toBe(1);
    abort.abort(reason);
    await rejection;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(signals[0]?.aborted).toBe(false);
    expect(probe.held()).toBe(1);
    expect(probe.queued()).toBe(0);
    finish(answer());
    await expect(running).resolves.toBe('{}');
    expect(probe.held()).toBe(0);
    expect(probe.events).toEqual(['acquire', 'succeeded', 'release']);
  });

  it('aborts the in-flight fetch when the request signal aborts', async () => {
    const probe = slotProbe();
    let seen: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => {
      const signal = init?.signal;
      if (!signal) return Promise.reject(new Error('fetch was not given a signal'));
      seen = signal;
      return new Promise((_resolve, reject) => {
        const fail = () => reject(signal.reason);
        if (signal.aborted) fail();
        else signal.addEventListener('abort', fail, { once: true });
      });
    });
    const abort = new AbortController();
    const reason = new DOMException('review cancelled', 'AbortError');
    const pending = provider({ fetchImpl, limiter: probe.limiter }).complete(request(abort.signal));
    const rejection = expect(pending).rejects.toBe(reason);
    await vi.waitFor(() => expect(seen).toBeInstanceOf(AbortSignal));
    expect(seen?.aborted).toBe(false);
    abort.abort(reason);
    expect(seen?.aborted).toBe(true);
    expect(seen?.reason).toBe(reason);
    await rejection;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(probe.held()).toBe(0);
    expect(probe.events).toEqual(['acquire', 'release']);
  });

  it('sends the first request free and does not retry when the shared budget is spent', async () => {
    const open = new AttemptBudget(1);
    const free = slotProbe();
    const freeFetch = vi.fn<typeof fetch>().mockImplementation(async () => answer());
    await expect(
      provider({ fetchImpl: freeFetch, limiter: free.limiter, attemptBudget: open }).complete(
        request(),
      ),
    ).resolves.toBe('{}');
    expect(freeFetch).toHaveBeenCalledTimes(1);
    expect(open.snapshot()).toEqual({ max: 1, used: 0, remaining: 1 });
    expect(free.held()).toBe(0);
    expect(free.events).toEqual(['acquire', 'succeeded', 'release']);

    vi.useFakeTimers();
    const spent = new AttemptBudget(1);
    expect(spent.tryTake()).toBe(true);
    const blocked = slotProbe();
    const blockedFetch = vi.fn<typeof fetch>().mockResolvedValue(busy());
    const pending = provider({
      fetchImpl: blockedFetch,
      limiter: blocked.limiter,
      attemptBudget: spent,
    }).complete(request());
    const failure = expect(pending).rejects.toThrow(
      'Vision model HTTP 429 for m. The shared attempt budget is exhausted.',
    );
    await vi.runAllTimersAsync();
    await failure;
    expect(blockedFetch).toHaveBeenCalledTimes(1);
    expect(blocked.events).toEqual(['acquire', 'release']);
    expect(blocked.held()).toBe(0);
    expect(spent.snapshot()).toEqual({ max: 1, used: 1, remaining: 0 });
  });

  it('does not send schema repair feedback when the shared budget is spent', async () => {
    const spent = new AttemptBudget(1);
    expect(spent.tryTake()).toBe(true);
    const probe = slotProbe();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(answer('{"ok":true}'));
    await expect(
      provider({
        fetchImpl,
        limiter: probe.limiter,
        attemptBudget: spent,
        answerFormat,
      }).complete(request(), 'title: Required'),
    ).rejects.toThrow(
      'Vision model repair for m was not sent; the shared attempt budget is exhausted.',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(probe.events).toEqual([]);
    expect(probe.held()).toBe(0);
    expect(spent.snapshot()).toEqual({ max: 1, used: 1, remaining: 0 });
  });
});
