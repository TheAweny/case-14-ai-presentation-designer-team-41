/** Ключ localStorage: какие закреплённые проекты в панели раскрыты. */
export const EXPANDED_PROJECTS_KEY = 'lct.sidebar.expanded';

/**
 * Разобрать сохранённый список id. null — ключа нет или значение чужое: панель тогда
 * раскрывает первый закреплённый проект сама, а не считает, что человек всё свернул.
 */
export function parseExpandedProjects(raw: string | null): readonly string[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) return null;
    return parsed;
  } catch {
    return null;
  }
}
