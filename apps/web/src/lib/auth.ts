/**
 * Аккаунты. Регистрации нет: первого администратора создаёт установщик (`ADMIN_EMAIL` и
 * `ADMIN_PASSWORD` в `.env`), остальных — администратор в настройках. Всё, что человек сделал —
 * проекты, шаблоны, презентации, чаты, — принадлежит его аккаунту; чужого API не отдаёт.
 *
 * Модуль без React и DOM: разбор настроек и адреса возврата проверяются тестами.
 */

/** Cookie сессии. Содержимое — подписанный токен (`session-token.ts`). */
export const SESSION_COOKIE = 'lct_session';

/** Страница входа. Proxy её не охраняет, остальные страницы ведут сюда гостя. */
export const LOGIN_PATH = '/login';

/** Параметр адреса входа: куда вернуться после входа. */
export const NEXT_PARAM = 'next';

/** Администратор заводит аккаунты, глобальные подключения к моделям и общие шаблоны. */
export type AccountRole = 'admin' | 'user';

export interface Account {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: AccountRole;
  /** Картинка: null — знак по id, `preset:N` — выбранный знак, иначе data URL (`avatars.ts`). */
  readonly avatar?: string | null;
  /** Server-only login handoff; never placed in account context or serialized to the browser. */
  readonly sessionToken?: string;
}

export interface AuthSource {
  /** Есть ли вообще кому входить. Нет — страница входа подсказывает, как завести аккаунт. */
  hasAccounts(): Promise<boolean>;
  /** Аккаунт по почте и паролю или null. Почему не вышло, не говорим — так безопаснее. */
  verifyPassword(email: string, password: string): Promise<Account | null>;
  /** Аккаунт по id из сессии или null: пользователя за это время могли убрать. */
  getAccount(userId: string): Promise<Account | null>;
}

/** Почта для сравнения: без пробелов по краям и без регистра. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Куда вернуть человека после входа. Только путь этого же сайта: `//evil.example` и
 * `/\evil.example` браузер понял бы как чужой адрес. Сама страница входа — не цель.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/';
  }
  const path = value.split(/[?#]/, 1)[0];
  return path === LOGIN_PATH || path?.startsWith(`${LOGIN_PATH}/`) ? '/' : value;
}

/** Адрес входа, который вернёт на `path` (путь с параметрами). */
export function loginHref(path: string): string {
  return path === '/' ? LOGIN_PATH : `${LOGIN_PATH}?${NEXT_PARAM}=${encodeURIComponent(path)}`;
}

/** Секрет подписи сессий, пока его никто не задал. Годится только для разработки. */
const DEVELOPMENT_SECRET = 'lct-local-development-session-secret';

/**
 * Секрет подписи сессий из `AUTH_SECRET`. В продакшене без него не запускаемся: иначе сессию
 * подделал бы любой, кто читал этот файл.
 */
export function authSecret(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const secret = env.AUTH_SECRET?.trim();
  if (secret) return secret;
  if (env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET is required in production: it signs session cookies.');
  }
  return DEVELOPMENT_SECRET;
}
