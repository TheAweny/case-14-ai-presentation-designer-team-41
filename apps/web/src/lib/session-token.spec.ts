import { describe, expect, it } from 'vitest';
import { signSessionToken, verifySessionToken } from './session-token';

const SECRET = 'test-secret';
const NOW = 1_800_000_000_000;

describe('session token', () => {
  it('returns the user of a fresh token', async () => {
    const token = await signSessionToken('анна@example.com', NOW + 1000, SECRET);
    expect(await verifySessionToken(token, SECRET, NOW)).toBe('анна@example.com');
  });

  it('rejects an expired token', async () => {
    const token = await signSessionToken('a@example.com', NOW, SECRET);
    expect(await verifySessionToken(token, SECRET, NOW)).toBeNull();
  });

  it('rejects a token signed with another secret', async () => {
    const token = await signSessionToken('a@example.com', NOW + 1000, 'other');
    expect(await verifySessionToken(token, SECRET, NOW)).toBeNull();
  });

  it('rejects a token whose user was swapped', async () => {
    const token = await signSessionToken('a@example.com', NOW + 1000, SECRET);
    const forged = await signSessionToken('b@example.com', NOW + 1000, SECRET);
    const [, expires, signature] = token.split('.');
    const [user] = forged.split('.');
    expect(await verifySessionToken(`${user}.${expires}.${signature}`, SECRET, NOW)).toBeNull();
  });

  it('rejects garbage and a missing cookie', async () => {
    expect(await verifySessionToken(undefined, SECRET, NOW)).toBeNull();
    expect(await verifySessionToken('', SECRET, NOW)).toBeNull();
    expect(await verifySessionToken('a.b', SECRET, NOW)).toBeNull();
    expect(await verifySessionToken('a!.b.c', SECRET, NOW)).toBeNull();
  });
});
