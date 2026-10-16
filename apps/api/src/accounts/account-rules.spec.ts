import { describe, expect, it } from 'vitest';
import {
  avatarProblem,
  configuredAdmin,
  emailProblem,
  MAX_AVATAR_LENGTH,
  nameProblem,
  passwordProblem,
} from './account-rules.js';

describe('account rules', () => {
  it('accepts an ordinary email, password and name', () => {
    expect(emailProblem(' Ann@Example.com ')).toBeNull();
    expect(passwordProblem('long-enough')).toBeNull();
    expect(nameProblem('Анна Ли')).toBeNull();
  });

  it('refuses a malformed email, a short password and an empty name', () => {
    expect(emailProblem('ann')).not.toBeNull();
    expect(emailProblem(undefined)).not.toBeNull();
    expect(passwordProblem('short')).not.toBeNull();
    expect(nameProblem('   ')).not.toBeNull();
  });
});

describe('configuredAdmin', () => {
  it('reads the administrator from .env, naming them by the email when no name is given', () => {
    expect(
      configuredAdmin({ ADMIN_EMAIL: 'Root@Example.com', ADMIN_PASSWORD: 'secret-123' }),
    ).toEqual({
      email: 'root@example.com',
      password: 'secret-123',
      name: 'root',
    });
  });

  it('names nobody when the email or a usable password is missing', () => {
    expect(configuredAdmin({})).toBeNull();
    expect(
      configuredAdmin({ ADMIN_EMAIL: 'root@example.com', ADMIN_PASSWORD: 'short' }),
    ).toBeNull();
    expect(configuredAdmin({ ADMIN_PASSWORD: 'secret-123' })).toBeNull();
  });
});

describe('avatar', () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]).toString('base64');
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]).toString('base64');
  const webp = Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1').toString('base64');

  it('takes nothing, a mark of ten, or a small PNG, JPEG or WebP image', () => {
    expect(avatarProblem(null)).toBeNull();
    expect(avatarProblem('preset:0')).toBeNull();
    expect(avatarProblem('preset:9')).toBeNull();
    expect(avatarProblem(`data:image/png;base64,${png}`)).toBeNull();
    expect(avatarProblem(`data:image/jpeg;base64,${jpeg}`)).toBeNull();
    expect(avatarProblem(`data:image/webp;base64,${webp}`)).toBeNull();
  });

  it('refuses a mark that is not there, other formats and an image that is not what it says', () => {
    expect(avatarProblem('preset:10')).not.toBeNull();
    expect(avatarProblem(42)).not.toBeNull();
    expect(avatarProblem('https://example.com/me.png')).not.toBeNull();
    expect(avatarProblem('data:image/svg+xml;base64,PHN2Zz4=')).not.toBeNull();
    expect(avatarProblem(`data:image/png;base64,${jpeg}`)).not.toBeNull();
    expect(avatarProblem(`data:image/png;base64,${'A'.repeat(MAX_AVATAR_LENGTH)}`)).not.toBeNull();
  });
});
