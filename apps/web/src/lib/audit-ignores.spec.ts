import { describe, expect, it } from 'vitest';
import { ignoresKey, loadIgnores, readIgnores, saveIgnores } from './audit-ignores';
import type { KeyValueStore } from './draft-storage';

function memoryStore(): KeyValueStore & { readonly data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (key) => data.get(key),
    set: async (key, value) => {
      data.set(key, value);
    },
    del: async (key) => {
      data.delete(key);
    },
    keys: async () => [...data.keys()],
  };
}

describe('audit ignores', () => {
  it('keeps the ignored issues of each deck apart and reads them back', async () => {
    const store = memoryStore();
    await saveIgnores(store, 'a', ['off-slide:edge:s1:t']);
    await saveIgnores(store, 'b', ['contrast:text:s2:x']);
    expect(await loadIgnores(store, 'a')).toEqual(['off-slide:edge:s1:t']);
    expect(await loadIgnores(store, 'b')).toEqual(['contrast:text:s2:x']);
  });

  it('erases the record when nothing is ignored any more', async () => {
    const store = memoryStore();
    await saveIgnores(store, 'a', ['x']);
    await saveIgnores(store, 'a', []);
    expect(store.data.has(ignoresKey('a'))).toBe(false);
  });

  it('treats anything but a list of ids as no ignores', () => {
    expect(readIgnores(undefined)).toEqual([]);
    expect(readIgnores({ ids: ['x'] })).toEqual([]);
    expect(readIgnores(['x', 3, '', null])).toEqual(['x']);
  });
});
