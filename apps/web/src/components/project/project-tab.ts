/**
 * Вкладки страницы проекта и их значение в адресе (`?tab=`). Отдельно от клиентских
 * компонентов: серверная страница разбирает адрес этой же функцией.
 */
export const PROJECT_TABS = ['decks', 'templates'] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

/** Вкладка по умолчанию: её в адресе не пишем. */
export const DEFAULT_PROJECT_TAB: ProjectTab = 'decks';

export function isProjectTab(value: unknown): value is ProjectTab {
  return typeof value === 'string' && (PROJECT_TABS as readonly string[]).includes(value);
}

/** Вкладка из `?tab=`: незнакомое значение или несколько значений — вкладка по умолчанию. */
export function parseProjectTab(value: string | string[] | null | undefined): ProjectTab {
  return isProjectTab(value) ? value : DEFAULT_PROJECT_TAB;
}

/**
 * Параметр адреса вкладки «Шаблоны»: чей профиль раскрыт под рядом карточек. Без него (или с
 * шаблоном, которого в проекте уже нет) раскрыт первый шаблон проекта.
 */
export const TEMPLATE_PARAM = 'template';

/**
 * Какой шаблон раскрыт: из адреса, если он прикреплён к проекту, иначе первый. Шаблонов нет —
 * null.
 */
export function selectedTemplateId(
  value: string | string[] | null | undefined,
  templateIds: readonly string[],
): string | null {
  if (typeof value === 'string' && templateIds.includes(value)) return value;
  return templateIds[0] ?? null;
}

/**
 * Поменять параметр адреса без перехода: вкладка и раскрытый шаблон переключаются мгновенно,
 * а ссылкой на них всё равно можно поделиться. Next следит за history, и `useSearchParams`
 * видит новый адрес. `null` убирает параметр.
 */
export function replaceSearchParam(name: string, value: string | null): void {
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}
