import { describe, expect, it } from 'vitest';
import { isPublicWebAddress } from './web-address.js';

describe('public web addresses', () => {
  it('allows ordinary public addresses and refuses mapped, private, and documentation ranges', () => {
    expect(isPublicWebAddress('8.8.8.8')).toBe(true);
    expect(isPublicWebAddress('2001:4860:4860::8888')).toBe(true);
    expect(isPublicWebAddress('240.0.0.1')).toBe(false);
    expect(isPublicWebAddress('255.255.255.255')).toBe(false);
    expect(isPublicWebAddress('2001::1')).toBe(false);
    expect(isPublicWebAddress('2001:0:1234::1')).toBe(false);
    expect(isPublicWebAddress('::ffff:7f00:1')).toBe(false);
    expect(isPublicWebAddress('::ffff:127.0.0.1')).toBe(false);
    expect(isPublicWebAddress('::ffff:8.8.8.8')).toBe(false);
    expect(isPublicWebAddress('[::ffff:7f00:1]')).toBe(false);
    expect(isPublicWebAddress('127.0.0.1')).toBe(false);
    expect(isPublicWebAddress('10.1.2.3')).toBe(false);
    expect(isPublicWebAddress('192.168.0.1')).toBe(false);
    expect(isPublicWebAddress('169.254.1.1')).toBe(false);
    expect(isPublicWebAddress('224.0.0.1')).toBe(false);
    expect(isPublicWebAddress('192.0.2.1')).toBe(false);
    expect(isPublicWebAddress('198.51.100.1')).toBe(false);
    expect(isPublicWebAddress('203.0.113.1')).toBe(false);
    expect(isPublicWebAddress('2001:db8::1')).toBe(false);
    expect(isPublicWebAddress('2002::1')).toBe(false);
    expect(isPublicWebAddress('3fff::1')).toBe(false);
    expect(isPublicWebAddress('fe80::1')).toBe(false);
    expect(isPublicWebAddress('fc00::1')).toBe(false);
    expect(isPublicWebAddress('::1')).toBe(false);
    expect(isPublicWebAddress('example.org')).toBe(false);
  });
});
