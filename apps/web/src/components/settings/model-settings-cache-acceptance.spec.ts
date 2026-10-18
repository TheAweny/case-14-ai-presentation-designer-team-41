import { describe, expect, it, vi } from 'vitest';
import type { ModelSettings } from '@/lib/model-settings';
import { createModelSettingsCache } from './model-settings-cache';

const settings = (id: string): ModelSettings => ({
  connections: [],
  roles: [{ role: 'writer', kind: 'model', connectionId: id, modelId: id }],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('shared model settings source acceptance', () => {
  it('shares one request while settings and multiple composers subscribe', async () => {
    const reply = deferred<ModelSettings>();
    const fetch = vi.fn(() => reply.promise);
    const cache = createModelSettingsCache(fetch);
    const first = cache.load('owner');
    const second = cache.load('owner');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    reply.resolve(settings('personal'));
    await first;
    expect(cache.read('owner').settings).toEqual(settings('personal'));
  });

  it.each([false, true])('a late load cannot overwrite a mutation (failure=%s)', async (failed) => {
    const reply = deferred<ModelSettings>();
    const cache = createModelSettingsCache(() => reply.promise);
    const loading = cache.load('owner');
    cache.publish('owner', settings('new-personal-model'));
    if (failed) reply.reject(new Error('old load failed'));
    else reply.resolve(settings('old-shared-model'));
    await loading;
    expect(cache.read('owner')).toEqual({
      settings: settings('new-personal-model'),
      failed: false,
    });
  });

  it('keeps account results separate even when requests finish out of order', async () => {
    const first = deferred<ModelSettings>();
    const second = deferred<ModelSettings>();
    const fetch = vi.fn((id: string) => (id === 'alice' ? first.promise : second.promise));
    const cache = createModelSettingsCache(fetch);
    const a = cache.load('alice');
    const b = cache.load('bob');
    expect(cache.read('bob').settings).toBeNull();
    second.resolve(settings('bob-private'));
    await b;
    first.resolve(settings('alice-private'));
    await a;
    expect(cache.read('bob').settings).toEqual(settings('bob-private'));
    expect(cache.read('alice').settings).toEqual(settings('alice-private'));
    expect(cache.read(null).settings).toBeNull();
    await cache.load(null);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries a failed request and publishes the recovered snapshot', async () => {
    const fetch = vi
      .fn<() => Promise<ModelSettings>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(settings('recovered'));
    const cache = createModelSettingsCache(fetch);
    await cache.load('owner');
    expect(cache.read('owner').failed).toBe(true);
    await cache.load('owner');
    expect(cache.read('owner')).toEqual({ settings: settings('recovered'), failed: false });
  });
});
