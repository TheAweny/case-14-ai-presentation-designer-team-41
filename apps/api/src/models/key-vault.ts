import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Encryption of model API keys at rest. A key is stored only as AES-256-GCM ciphertext; the
 * secret it is encrypted under comes from `MODEL_KEYS_SECRET`, which `lct onboard` generates once
 * per installation and keeps in `.env`. A dump of the database, a copied volume or a read through
 * an injection yields ciphertext that is useless without that file.
 *
 * Each ciphertext is bound to its connection: the connection id is authenticated data, so a
 * ciphertext moved to another row does not decrypt. The version prefix leaves room to change the
 * secret later without losing stored keys.
 *
 * The secret is not used as a key directly. HKDF turns it into one, so any long random string
 * works, whatever its encoding.
 */

/** Shorter than this, a secret is a password rather than a random value, and it is refused. */
export const MODEL_KEYS_SECRET_MIN_LENGTH = 32;

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** The secret is missing or too short: keys cannot be stored or read. */
export class KeyVaultUnavailableError extends Error {
  override readonly name = 'KeyVaultUnavailableError';
  constructor() {
    super(
      `MODEL_KEYS_SECRET is not set or shorter than ${MODEL_KEYS_SECRET_MIN_LENGTH} characters; ` +
        'run lct onboard or set it in .env.',
    );
  }
}

/** A stored key cannot be decrypted: the secret changed, or the ciphertext was altered or moved. */
export class KeyDecryptionError extends Error {
  override readonly name = 'KeyDecryptionError';
  constructor() {
    super('A stored model key cannot be decrypted with the current MODEL_KEYS_SECRET.');
  }
}

export interface KeyVault {
  readonly available: boolean;
  encrypt(plaintext: string, connectionId: string): string;
  decrypt(ciphertext: string, connectionId: string): string;
}

function aad(connectionId: string): Buffer {
  return Buffer.from(`model-connection:${connectionId}`, 'utf8');
}

export function createKeyVault(secret: string | undefined): KeyVault {
  const trimmed = secret?.trim() ?? '';
  const key =
    trimmed.length >= MODEL_KEYS_SECRET_MIN_LENGTH
      ? Buffer.from(hkdfSync('sha256', trimmed, 'lct26-model-keys', VERSION, 32))
      : null;

  const requireKey = (): Buffer => {
    if (key === null) throw new KeyVaultUnavailableError();
    return key;
  };

  return {
    available: key !== null,

    encrypt(plaintext, connectionId) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', requireKey(), iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(aad(connectionId));
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return [VERSION, iv, cipher.getAuthTag(), body]
        .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
        .join('.');
    },

    decrypt(ciphertext, connectionId) {
      const secretKey = requireKey();
      const [version, iv, tag, body] = ciphertext.split('.');
      if (version !== VERSION || !iv || !tag || body === undefined) throw new KeyDecryptionError();
      try {
        const decipher = createDecipheriv('aes-256-gcm', secretKey, Buffer.from(iv, 'base64url'), {
          authTagLength: TAG_BYTES,
        });
        decipher.setAAD(aad(connectionId));
        decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([
          decipher.update(Buffer.from(body, 'base64url')),
          decipher.final(),
        ]).toString('utf8');
      } catch {
        throw new KeyDecryptionError();
      }
    },
  };
}
