'use server';

import { cookies } from 'next/headers';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale, type Locale } from './config';

/**
 * Меняет язык интерфейса. После записи cookie Next сам перерисовывает текущую страницу на
 * сервере с новым словарём, а состояние клиента — положение панели, выбранный инструмент —
 * остаётся как было.
 *
 * Серверное действие — публичная точка входа, поэтому значение проверяем, несмотря на тип.
 */
export async function setLocale(locale: Locale): Promise<void> {
  if (!isLocale(locale)) return;
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
  });
}
