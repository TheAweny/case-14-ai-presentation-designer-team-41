/**
 * Окно настроек в адресе: `?settings=models` открывает раздел «Модели» на любой странице — так
 * на настройки можно дать ссылку. Закрытие убирает параметр, остальной адрес не трогается.
 *
 * Модуль без React и DOM: разбор адреса и клавиши проверяются тестами.
 */

export const SETTINGS_PARAM = 'settings';

export const SETTINGS_SECTIONS = ['general', 'editor', 'shortcuts', 'decks', 'models'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/**
 * Раздел по значению параметра: null — окно закрыто. Незнакомое значение открывает «Общие»: ссылка
 * на раздел, которого больше нет, всё равно ведёт в настройки.
 */
export function settingsSection(value: string | null | undefined): SettingsSection | null {
  if (value === null || value === undefined) return null;
  return (SETTINGS_SECTIONS as readonly string[]).includes(value)
    ? (value as SettingsSection)
    : 'general';
}

/**
 * Тот же адрес с открытым разделом (`section`) или без окна (null). Путь, прочие параметры и якорь
 * остаются как были. `href` — полный адрес или путь с параметрами.
 */
export function withSettings(href: string, section: SettingsSection | null): string {
  const url = new URL(href, 'http://settings.invalid');
  if (section === null) url.searchParams.delete(SETTINGS_PARAM);
  else url.searchParams.set(SETTINGS_PARAM, section);
  return `${url.pathname}${url.search}${url.hash}`;
}

export interface SettingsKey {
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/**
 * Ctrl+, (на Mac ⌘+,) — настройки, как в большинстве приложений. Клавиша физическая: запятая в
 * русской раскладке печатает «б», но сочетание то же.
 */
export function isSettingsShortcut(event: SettingsKey): boolean {
  return (
    event.code === 'Comma' && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey
  );
}
