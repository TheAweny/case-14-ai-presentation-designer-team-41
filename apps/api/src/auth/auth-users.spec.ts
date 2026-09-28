import { describe, expect, it } from 'vitest';
import { parseAuthUsers } from './auth-users.js';

describe('parseAuthUsers', () => {
  it('reads the list lct writes, skipping broken and repeated entries', () => {
    expect(
      parseAuthUsers(
        'Ann@Example.com:pw-123456:Ann Lee;broken;ann@example.com:x:Dup;b@c.io:pw-654321',
      ),
    ).toEqual([
      { email: 'ann@example.com', password: 'pw-123456', name: 'Ann Lee' },
      { email: 'b@c.io', password: 'pw-654321', name: 'b' },
    ]);
  });

  it('gives nothing for an unset list, which leaves the accounts table alone', () => {
    expect(parseAuthUsers(undefined)).toEqual([]);
  });
});
