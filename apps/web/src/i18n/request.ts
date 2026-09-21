import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE, resolveLocale, type Locale } from './config';

/** Словари грузятся по одному на запрос: в сборку попадают оба, в ответ — только нужный. */
const MESSAGES = {
  ru: () => import('./messages/ru.json'),
  en: () => import('./messages/en.json'),
} satisfies Record<Locale, () => Promise<unknown>>;

/** Точка входа next-intl: плагин в next.config находит этот файл сам. */
export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const locale = resolveLocale({
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get('accept-language'),
  });

  return { locale, messages: (await MESSAGES[locale]()).default };
});
