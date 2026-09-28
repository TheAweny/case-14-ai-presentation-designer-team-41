import { describe, expect, it } from 'vitest';
import { configuredAdmin, emailProblem, nameProblem, passwordProblem } from './account-rules.js';

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
