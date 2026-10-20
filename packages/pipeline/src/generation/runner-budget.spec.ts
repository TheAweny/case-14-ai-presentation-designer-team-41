import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { boundedGenerationProvider, openGenerationStage } from './runner.js';
import type { TextProvider } from './provider.js';

afterEach(() => vi.useRealTimers());

describe('generation stage deadlines with a fake clock', () => {
  it('keeps an unlimited stage cancellable without creating an infinite timer', async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const stage = openGenerationStage(parent.signal, Number.POSITIVE_INFINITY);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(900_000);
    expect(stage.signal.aborted).toBe(false);
    const pending = stage.run(() => new Promise<never>(() => undefined));
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    parent.abort(new DOMException('Stop', 'AbortError'));
    await rejected;
    stage.dispose();
  });
  it('stops a writer at the reserve boundary without aborting export', async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const deadline = Date.now() + 290_000;
    const content = openGenerationStage(parent.signal, deadline - 60_000);
    let release!: (value: string) => void;
    const pending = content.run(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(230_000);
    await rejected;
    expect(content.signal.aborted).toBe(true);
    expect(parent.signal.aborted).toBe(false);
    expect(deadline - Date.now()).toBe(60_000);
    release('late writer');
    await vi.advanceTimersByTimeAsync(0);
    content.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains accepted partial tasks on retry with a new stage clock', async () => {
    vi.useFakeTimers();
    const saved = new Map<string, string>();
    const parent = new AbortController();
    const first = openGenerationStage(parent.signal, Date.now() + 20);
    await first.run(async () => {
      saved.set('writer-a', 'accepted');
    });
    const pending = first.run(() => new Promise<never>(() => undefined));
    const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(20);
    await rejected;
    first.dispose();
    const retry = openGenerationStage(parent.signal, Date.now() + 20);
    expect(await retry.run(async () => saved.get('writer-a'))).toBe('accepted');
    retry.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates Stop and rejects a factory that ignores abort', async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const child = openGenerationStage(parent.signal, Date.now() + 100);
    const pending = child.run(() => new Promise<never>(() => undefined));
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    parent.abort(new DOMException('Stop', 'AbortError'));
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    child.dispose();
  });

  it('does not start work at an expired stage boundary', async () => {
    const child = openGenerationStage(new AbortController().signal, Date.now());
    const work = vi.fn(async () => 'late');
    await expect(child.run(work)).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(work).not.toHaveBeenCalled();
    child.dispose();
  });
});

describe('semantic attempts do not change provider concurrency or durable task inputs', () => {
  it('limits a repeated repair while keeping separate slides and variants independent', async () => {
    const generate = vi.fn();
    const inner: TextProvider = {
      model: 'offline',
      async generate(agent, instructions, input, schema) {
        generate(agent, instructions, input, schema);
        return schema.parse('accepted');
      },
    };
    const provider = boundedGenerationProvider(inner);
    const signal = new AbortController().signal;
    const input = { purpose: 'One', variant: 'dense', slots: [{ slotId: 'body' }] };
    for (let i = 0; i < 2; i++)
      await provider.generate('rewriter', 'registry instructions', input, z.string(), signal);
    await expect(
      provider.generate('rewriter', 'registry instructions', input, z.string(), signal),
    ).rejects.toThrow('Semantic attempt limit');
    await provider.generate(
      'rewriter',
      'registry instructions',
      { ...input, purpose: 'Two' },
      z.string(),
      signal,
    );
    await provider.generate(
      'rewriter',
      'registry instructions',
      { ...input, variant: 'airy' },
      z.string(),
      signal,
    );
    expect(generate).toHaveBeenCalledTimes(4);
    expect(generate.mock.calls[0]?.[2]).toBe(input);
  });
});
