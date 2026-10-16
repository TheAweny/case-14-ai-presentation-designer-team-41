import { describe, expect, it } from 'vitest';
import { authSecret, loginHref, safeNextPath } from './auth';

describe('safeNextPath', () => {
  it('keeps a local path with its query', () => {
    expect(safeNextPath('/decks/1?settings=models')).toBe('/decks/1?settings=models');
  });

  it('falls back home for foreign or missing targets', () => {
    for (const value of [
      null,
      undefined,
      '',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
    ]) {
      expect(safeNextPath(value)).toBe('/');
    }
  });

  it('never returns to the login page itself', () => {
    expect(safeNextPath('/login')).toBe('/');
    expect(safeNextPath('/login?next=/x')).toBe('/');
  });
});

describe('loginHref', () => {
  it('omits the target for the home page', () => {
    expect(loginHref('/')).toBe('/login');
    expect(loginHref('/projects/p1?tab=decks')).toBe('/login?next=%2Fprojects%2Fp1%3Ftab%3Ddecks');
  });
});

describe('authSecret', () => {
  it('uses AUTH_SECRET when set', () => {
    expect(authSecret({ AUTH_SECRET: ' s ', NODE_ENV: 'production' })).toBe('s');
  });

  it('refuses to run in production without a secret', () => {
    expect(() => authSecret({ NODE_ENV: 'production' })).toThrow(/AUTH_SECRET/);
    expect(authSecret({ NODE_ENV: 'development' })).not.toBe('');
  });
});
