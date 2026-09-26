/**
 * Куда ставить фокус вокруг объектов главного меню — карточек, строк, пунктов сайдбара.
 * Объект — обёртка с `data-object`, в ней ссылка, на которой и стоит фокус.
 */

/** Помечает объект, который уже убран из списка, но ещё не ушёл из разметки. */
const REMOVED_ATTRIBUTE = 'data-removed';

/** Ссылка объекта: на неё возвращается фокус после меню и диалогов. */
export function objectFocusTarget(root: Element | null): HTMLElement | null {
  return root?.querySelector<HTMLElement>('a[href]') ?? null;
}

export function focusObject(root: Element | null): void {
  objectFocusTarget(root)?.focus();
}

/**
 * Куда уйдёт фокус, когда объект удалят: на соседа в том же списке — следующего, а если
 * его нет, предыдущего. Соседей нет — на то, что переживёт опустевший список: вкладка целиком
 * (в ней список сменится пустым состоянием) или заголовок секции.
 *
 * Считать нужно до удаления: потом объекта в разметке уже нет.
 */
export function removalFocusTarget(root: Element | null): HTMLElement | null {
  if (!root) return null;
  const item = root.closest('li');
  const list = item?.parentElement;
  if (item && list) {
    const items = [...list.children];
    const at = items.indexOf(item);
    const alive = (candidate: Element | undefined) =>
      candidate !== undefined &&
      candidate !== item &&
      candidate.querySelector(`[${REMOVED_ATTRIBUTE}]`) === null
        ? objectFocusTarget(candidate)
        : null;
    for (let index = at + 1; index < items.length; index += 1) {
      const next = alive(items[index]);
      if (next) return next;
    }
    for (let index = at - 1; index >= 0; index -= 1) {
      const previous = alive(items[index]);
      if (previous) return previous;
    }
  }
  const panel = root.closest<HTMLElement>('[role="tabpanel"]');
  if (panel) return panel;
  const heading = root.closest('section')?.querySelector<HTMLElement>('h1, h2');
  // Заголовок сам фокус не принимает: принимает только программно, в порядок Tab не встаёт.
  if (heading && !heading.hasAttribute('tabindex')) heading.tabIndex = -1;
  return heading ?? null;
}
