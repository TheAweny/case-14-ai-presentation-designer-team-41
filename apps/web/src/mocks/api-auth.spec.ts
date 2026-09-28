import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiAuth } from './api-auth';

function answer(body: string, status = 200) {
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(body, { status })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createApiAuth', () => {
  const row = { id: 'a@b.co', email: 'a@b.co', name: 'Ann' };

  it('reads the account the API found', async () => {
    answer(JSON.stringify({ account: row }));
    await expect(createApiAuth().verifyPassword('a@b.co', 'pw')).resolves.toEqual({
      userId: 'a@b.co',
      email: 'a@b.co',
      name: 'Ann',
    });
  });

  it('treats a wrong password as no account, not as an error', async () => {
    answer(JSON.stringify({ account: null }));
    await expect(createApiAuth().verifyPassword('a@b.co', 'bad')).resolves.toBeNull();
  });

  it('survives the empty body older API builds sent', async () => {
    answer('');
    await expect(createApiAuth().verifyPassword('a@b.co', 'bad')).resolves.toBeNull();
    answer(JSON.stringify(row));
    await expect(createApiAuth().getAccount('a@b.co')).resolves.toMatchObject({ name: 'Ann' });
  });
});
