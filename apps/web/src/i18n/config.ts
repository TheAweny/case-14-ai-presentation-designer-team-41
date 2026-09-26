/**
 * Языки интерфейса и выбор языка для запроса. Чистые функции без Next — их можно проверять
 * в отрыве от сервера.
 *
 * Язык интерфейса и язык колоды — разные вещи: на английском интерфейсе вполне собирают
 * презентацию на русском. Язык колоды задаётся в брифе и сюда не относится.
 */

export const LOCALES = ['ru', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'ru';

/**
 * Выбор хранится в cookie, а не в адресе: это рабочий инструмент, а не сайт для поиска, и
 * префикс локали в каждом маршруте ничего бы не дал. Имя то же, что next-intl читает по
 * умолчанию, — при переходе на маршрутизацию по локалям выбор пользователя не потеряется.
 */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

/** Год: язык — это настройка, а не состояние сессии. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Самоназвания. В переключателе язык подписан на нём самом, чтобы его нашёл и тот, кто не
 * читает на текущем языке интерфейса, поэтому в словари эти строки не выносятся.
 */
export const LOCALE_NAMES: Record<Locale, string> = {
  ru: 'Русский',
  en: 'English',
};

export function isLocale(value: unknown): value is Locale {
  return LOCALES.includes(value as Locale);
}

/**
 * Первый из известных нам языков в заголовке Accept-Language, по убыванию веса. Регион
 * отбрасываем: `en-GB` — это `en`. Язык с нулевым весом браузер явно просит не показывать.
 */
export function negotiateLocale(header: string | null | undefined): Locale | null {
  if (!header) return null;

  const ranked = header
    .split(',')
    .map((part, order) => {
      const [range = '', ...params] = part.trim().split(';');
      const q = params.map((param) => param.trim()).find((param) => param.startsWith('q='));
      const weight = q === undefined ? 1 : Number(q.slice(2));
      return {
        base: range.trim().toLowerCase().split('-')[0] ?? '',
        weight: Number.isFinite(weight) ? weight : 0,
        order,
      };
    })
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.order - b.order);

  return ranked.map((entry) => entry.base).find(isLocale) ?? null;
}

/** Явный выбор пользователя важнее браузера, браузер — важнее языка по умолчанию. */
export function resolveLocale({
  cookie,
  acceptLanguage,
}: {
  cookie?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  if (isLocale(cookie)) return cookie;
  return negotiateLocale(acceptLanguage) ?? DEFAULT_LOCALE;
}
