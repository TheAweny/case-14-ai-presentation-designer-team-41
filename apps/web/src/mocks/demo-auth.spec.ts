import { describe, expect, it } from 'vitest';
import { createDemoAuth } from './demo-auth';

const auth = createDemoAuth([{ email: 'anna@example.com', password: 's3cret', name: 'Анна' }]);
const ANNA = { userId: 'anna@example.com', email: 'anna@example.com', name: 'Анна' };

describe('demo auth', () => {
  it('signs in with the right password, ignoring email case', async () => {
    expect(await auth.verifyPassword(' Anna@Example.com ', 's3cret')).toEqual(ANNA);
  });

  it('refuses a wrong password and an unknown email alike', async () => {
    expect(await auth.verifyPassword('anna@example.com', 'S3cret')).toBeNull();
    expect(await auth.verifyPassword('nobody@example.com', 's3cret')).toBeNull();
  });

  it('finds the account of a session and forgets removed users', async () => {
    expect(await auth.getAccount('anna@example.com')).toEqual(ANNA);
    expect(await auth.getAccount('nobody@example.com')).toBeNull();
  });

  it('knows whether anyone can sign in', async () => {
    expect(await auth.hasAccounts()).toBe(true);
    expect(await createDemoAuth([]).hasAccounts()).toBe(false);
  });
});
