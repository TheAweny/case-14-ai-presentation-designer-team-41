import { describe, expect, it } from 'vitest';
import {
  accountColor,
  accountInitials,
  authSecret,
  loginHref,
  parseAuthUsers,
  safeNextPath,
} from './auth';

describe('parseAuthUsers', () => {
  it('reads email, password and a name that may contain colons', () => {
    expect(
      parseAuthUsers(' Anna@Example.com:s3cret:Анна Петрова ; b@example.com:pw:Team: Design'),
    ).toEqual([
      { email: 'anna@example.com', password: 's3cret', name: 'Анна Петрова' },
      { email: 'b@example.com', password: 'pw', name: 'Team: Design' },
    ]);
  });

  it('names a user after the mailbox when the name is missing', () => {
    expect(parseAuthUsers('ivan@example.com:pw')).toEqual([
      { email: 'ivan@example.com', password: 'pw', name: 'ivan' },
    ]);
  });

  it('skips broken entries and repeated emails', () => {
    expect(parseAuthUsers(';no-at:pw;c@example.com:;c@example.com:1;c@example.com:2')).toEqual([
      { email: 'c@example.com', password: '1', name: 'c' },
    ]);
    expect(parseAuthUsers(undefined)).toEqual([]);
  });
});

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

describe('avatar', () => {
  it('takes initials from the first two words, else from the email', () => {
    expect(accountInitials({ name: 'анна мария петрова', email: 'a@x.ru' })).toBe('АМ');
    expect(accountInitials({ name: ' ', email: 'zed@x.ru' })).toBe('Z');
  });

  it('keeps one non-gray color per user', () => {
    expect(accountColor('a@example.com')).toBe(accountColor('a@example.com'));
    expect(accountColor('a@example.com')).not.toBe('gray');
  });
});
