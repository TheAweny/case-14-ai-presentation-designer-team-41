import { signSessionToken } from '../src/lib/session-token';

/** `AUTH_SECRET` of the web server in `playwright.chat.config.ts`. */
const AUTH_SECRET = 'chat-e2e-session-secret';

/** Shaped like a token the API issues at sign-in; the fixture API never revokes it. */
const SESSION_TOKEN = 'chat-e2e-session'.padEnd(43, '0');

/** The `lct_session` cookie value of a signed-in `userId`, valid for an hour. */
export function sessionCookie(userId: string): Promise<string> {
  return signSessionToken(`${userId}:session:${SESSION_TOKEN}`, Date.now() + 3600000, AUTH_SECRET);
}
