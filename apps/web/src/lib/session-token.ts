/**
 * Токен сессии в cookie: `<id пользователя>.<истекает, мс>.<подпись>`, подпись — HMAC-SHA256.
 * Payload новых cookies содержит id и непрозрачный токен серверной сессии. `proxy.ts`
 * проверяет подпись; серверные действия и API дополнительно проверяют отзыв в PostgreSQL.
 * Старые cookies без серверного токена требуют повторного входа.
 *
 * Модуль на Web Crypto, без Node и React: работает и в proxy, и в тестах.
 */

/** Сколько живёт сессия: месяц, как у большинства рабочих приложений. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    // Длина, которой не бывает у base64: токен испорчен.
    return null;
  }
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** Подписать сессию пользователя, которая истекает в `expiresAt` (мс с эпохи). */
export async function signSessionToken(
  userId: string,
  expiresAt: number,
  secret: string,
): Promise<string> {
  const body = `${toBase64Url(encoder.encode(userId))}.${Math.floor(expiresAt).toString(36)}`;
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * Id пользователя из токена или null: токен испорчен, подпись чужая или срок вышел. Сравнение
 * подписи — `crypto.subtle.verify`, за постоянное время.
 */
export async function verifySessionToken(
  token: string | undefined,
  secret: string,
  now: number = Date.now(),
): Promise<string | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userPart = '', expiresPart = '', signaturePart = ''] = parts;
  const signature = fromBase64Url(signaturePart);
  const userBytes = fromBase64Url(userPart);
  const expiresAt = Number.parseInt(expiresPart, 36);
  if (!signature || !userBytes || !Number.isFinite(expiresAt) || expiresAt <= now) return null;
  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    signature,
    encoder.encode(`${userPart}.${expiresPart}`),
  );
  if (!valid) return null;
  const userId = new TextDecoder().decode(userBytes);
  return userId === '' ? null : userId;
}
