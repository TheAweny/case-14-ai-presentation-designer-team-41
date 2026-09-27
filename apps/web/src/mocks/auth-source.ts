import { parseAuthUsers } from '../lib/auth';
import { createDemoAuth } from './demo-auth';
import { createApiAuth } from './api-auth';

/**
 * Аккаунты, пока API нет. Отдельно от `sources.ts`: тот попадает и во вкладку (сессия
 * ассистента), а здесь `node:crypto` и пароли — им место только на сервере.
 *
 * Регистрации нет: пользователей заводит `AUTH_USERS` (формат — в `lib/auth.ts`).
 */
export const authSource = process.env.API_INTERNAL_URL
  ? createApiAuth()
  : createDemoAuth(parseAuthUsers(process.env.AUTH_USERS));
