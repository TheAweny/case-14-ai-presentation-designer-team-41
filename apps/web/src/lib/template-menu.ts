/**
 * Пункты меню шаблона в одном месте: их рисуют и кнопка «⋯», и правая кнопка.
 * Скачать исходный файл можно у любого видимого шаблона, в том числе чужого общего.
 * Переименовать и удалить — у владельца и администратора, открыть всем — только у администратора.
 *
 * Модуль без React: состав меню проверяется тестами.
 */

export type TemplateMenuAction = 'download' | 'rename' | 'share' | 'unshare' | 'delete';

export function templateMenuActions(template: {
  readonly editable: boolean;
  readonly canShare: boolean;
  readonly shared: boolean;
}): readonly TemplateMenuAction[] {
  const actions: TemplateMenuAction[] = ['download'];
  if (template.editable) actions.push('rename');
  if (template.canShare) actions.push(template.shared ? 'unshare' : 'share');
  if (template.editable) actions.push('delete');
  return actions;
}
