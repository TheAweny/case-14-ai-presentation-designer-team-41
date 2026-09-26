/**
 * Внешний вид проекта в интерфейсе: иконка и цвет, как у проектов в ChatGPT. Это палитра
 * оболочки, а не шаблона: стиль шаблона живёт в его профиле и сюда не попадает. Поэтому набор
 * иконок и цветов задан в коде и одинаков для любого шаблона.
 *
 * Здесь только идентификаторы и правила разбора: какая картинка стоит за иконкой, решает
 * компонент `ProjectIcon`, а сами цвета — токены `--project-*` в `globals.css`.
 */

/** Иконки проекта в порядке сетки выбора: первая — иконка по умолчанию. */
export const PROJECT_ICON_IDS = [
  'folder',
  'chart',
  'rocket',
  'briefcase',
  'idea',
  'target',
  'globe',
  'book',
  'graduation',
  'star',
  'flag',
  'megaphone',
  'shield',
  'heart',
  'code',
  'trophy',
  'money',
  'people',
  'palette',
  'leaf',
] as const;

export type ProjectIconId = (typeof PROJECT_ICON_IDS)[number];

/** Цвета проекта в порядке ряда выбора: первый, серый, — цвет по умолчанию. */
export const PROJECT_COLOR_IDS = [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
] as const;

export type ProjectColorId = (typeof PROJECT_COLOR_IDS)[number];

export interface ProjectAppearance {
  readonly icon: ProjectIconId;
  readonly color: ProjectColorId;
}

export const DEFAULT_PROJECT_APPEARANCE: ProjectAppearance = { icon: 'folder', color: 'gray' };

export function isProjectIconId(value: unknown): value is ProjectIconId {
  return typeof value === 'string' && (PROJECT_ICON_IDS as readonly string[]).includes(value);
}

export function isProjectColorId(value: unknown): value is ProjectColorId {
  return typeof value === 'string' && (PROJECT_COLOR_IDS as readonly string[]).includes(value);
}

/**
 * Внешний вид из чего угодно: из ответа сервера, из аргумента серверного действия. Незнакомая
 * иконка или цвет заменяются значением по умолчанию по отдельности: проект с иконкой, которой
 * интерфейс ещё не знает, сохраняет свой цвет.
 */
export function parseProjectAppearance(value: unknown): ProjectAppearance {
  const record =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    icon: isProjectIconId(record.icon) ? record.icon : DEFAULT_PROJECT_APPEARANCE.icon,
    color: isProjectColorId(record.color) ? record.color : DEFAULT_PROJECT_APPEARANCE.color,
  };
}

/** Цвет проекта как значение CSS: токен оболочки, у тёмной темы свой. */
export function projectColorVar(color: ProjectColorId): string {
  return `var(--project-${color})`;
}
