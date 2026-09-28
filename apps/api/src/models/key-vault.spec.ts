import { describe, expect, it } from 'vitest';
import { KeyDecryptionError, KeyVaultUnavailableError, createKeyVault } from './key-vault.js';

const SECRET = 'q4mR9v2LxT7pWc1nZ8bK3sHd6fJ0yGaE5uNo=';
const KEY = 'sk-proj-very-secret-0123456789WXYZ';

describe('createKeyVault', () => {
  it('round-trips a key and never stores it in the clear', () => {
    const vault = createKeyVault(SECRET);
    const stored = vault.encrypt(KEY, 'c1');
    expect(stored).not.toContain(KEY);
    expect(stored.startsWith('v1.')).toBe(true);
    expect(vault.decrypt(stored, 'c1')).toBe(KEY);
  });

  it('gives a different ciphertext every time, so equal keys are not visible as equal', () => {
    const vault = createKeyVault(SECRET);
    expect(vault.encrypt(KEY, 'c1')).not.toBe(vault.encrypt(KEY, 'c1'));
  });

  it('does not decrypt a ciphertext moved to another connection', () => {
    const vault = createKeyVault(SECRET);
    const stored = vault.encrypt(KEY, 'c1');
    expect(() => vault.decrypt(stored, 'c2')).toThrow(KeyDecryptionError);
  });

  it('does not decrypt under another secret or after tampering', () => {
    const stored = createKeyVault(SECRET).encrypt(KEY, 'c1');
    expect(() => createKeyVault(`${SECRET}x`).decrypt(stored, 'c1')).toThrow(KeyDecryptionError);
    const [version, iv, tag, body = ''] = stored.split('.');
    // The first character: the last one may carry only padding bits, and changing those
    // leaves the decoded bytes as they were.
    const flipped = `${body.startsWith('A') ? 'B' : 'A'}${body.slice(1)}`;
    expect(() =>
      createKeyVault(SECRET).decrypt([version, iv, tag, flipped].join('.'), 'c1'),
    ).toThrow(KeyDecryptionError);
    expect(() => createKeyVault(SECRET).decrypt('garbage', 'c1')).toThrow(KeyDecryptionError);
  });

  it('is unavailable without a long enough secret, and says so instead of storing keys', () => {
    for (const secret of [undefined, '', 'short-password']) {
      const vault = createKeyVault(secret);
      expect(vault.available).toBe(false);
      expect(() => vault.encrypt(KEY, 'c1')).toThrow(KeyVaultUnavailableError);
    }
  });
});
