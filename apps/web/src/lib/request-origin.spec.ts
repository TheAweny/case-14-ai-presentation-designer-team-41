import { describe, it, expect } from 'vitest';
import { trustedOrigin } from './request-origin';
describe('mutation origin', () => {
  it('refuses missing, hostile or downgraded origins', () => {
    expect(trustedOrigin(null, 'https://app.example')).toBe(false);
    expect(trustedOrigin('https://evil.example', 'https://app.example')).toBe(false);
    expect(trustedOrigin('http://localhost:13119', 'https://localhost:13119')).toBe(false);
  });
  it('accepts the pinned deployment origin and same-protocol loopback alias', () => {
    expect(trustedOrigin('https://app.example', 'http://web:3000', 'https://app.example')).toBe(
      true,
    );
    expect(trustedOrigin('http://127.0.0.1:13119', 'http://localhost:13119')).toBe(true);
  });
});
