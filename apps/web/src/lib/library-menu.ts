/**
 * Меню объектов главного меню — презентации и проекта. Список действий описан здесь один раз:
 * его рисуют и меню правой кнопки, и кнопка «⋯», и меню в шапке проекта, поэтому пункты,
 * их порядок и то, что из них пока недоступно, не расходятся между местами.
 *
 * Модуль без React и DOM: что показать и какая клавиша что делает, проверяется тестами.
 */

export const deckHref = (deckId: string) => `/decks/${encodeURIComponent(deckId)}`;
/** Все проекты. Страница одного проекта — `projectHref`. */
export const PROJECTS_HREF = '/projects';
export const projectHref = (projectId: string) => `/projects/${encodeURIComponent(projectId)}`;
/**
 * Параметр адреса главной и страницы проекта: с ним страница открывается с полем генерации в
 * фокусе. Так работают все кнопки «Новая презентация» — новая презентация начинается в поле.
 */
export const COMPOSE_PARAM = 'compose';
/** Новая презентация: поле генерации на главной, на шаблоне последнего проекта. */
export const NEW_DECK_HREF = `/?${COMPOSE_PARAM}=1`;
/** Новая презентация в проекте: поле генерации на странице проекта, на его шаблоне. */
export const newDeckInProjectHref = (projectId: string) =>
  `${projectHref(projectId)}?${COMPOSE_PARAM}=1`;
/** Значение `?compose=` из адреса: поле в фокусе только на явное `1`. */
export function isComposeRequested(value: string | readonly string[] | undefined): boolean {
  return value === '1';
}
/**
 * Параметр адреса страницы проекта: какая вкладка открыта. Вкладка по умолчанию в адресе не
 * пишется; значения — `PROJECT_TABS` (`components/project/project-tab.ts`).
 */
export const TAB_PARAM = 'tab';
/** Шаблоны проекта: вкладка, где их прикрепляют и открепляют. */
export const projectTemplatesHref = (projectId: string) =>
  `${projectHref(projectId)}?${TAB_PARAM}=templates`;
/** Чат с ассистентом: агент собирает колоду там; из истории открывается он, а не редактор. */
export const chatHref = (chatId: string) => `/chats/${encodeURIComponent(chatId)}`;
/** Куда ведёт карточка презентации: в чат, где её собрали, а колода без чата — в редактор. */
export const deckOpenHref = (deck: { readonly deckId: string; readonly chatId?: string | null }) =>
  deck.chatId ? chatHref(deck.chatId) : deckHref(deck.deckId);

/** Параметр адреса редактора: с ним колода открывается сразу в режиме показа. */
export const PRESENT_PARAM = 'present';
export const presentHref = (deckId: string) => `${deckHref(deckId)}?${PRESENT_PARAM}=1`;

/** Значение `?present=` из адреса: показ начинается только на явное `1`. */
export function isPresentRequested(value: string | readonly string[] | undefined): boolean {
  return value === '1';
}

export type LibraryMenuActionId =
  | 'open'
  | 'openInNewTab'
  | 'present'
  | 'newDeck'
  | 'pin'
  | 'unpin'
  | 'rename'
  | 'moveToProject'
  | 'appearance'
  | 'copyLink'
  | 'attachTemplate'
  | 'delete';

/**
 * Клавиша, которая делает то же, пока фокус на объекте. Подсказка у пункта показывается,
 * только если клавиша правда работает: Enter открывает ссылку сам браузер, F2 и Delete
 * ловит обёртка объекта (`objectKeyAction`).
 */
export type LibraryObjectKey = 'Enter' | 'F2' | 'Delete';

/** Почему пункт виден, но неактивен. */
export type LibraryMenuUnavailable = 'pendingApi';

export interface LibraryMenuItem {
  readonly id: LibraryMenuActionId;
  /** Куда ведёт пункт: переход, новая вкладка, показ или ссылка для буфера обмена. */
  readonly href?: string;
  readonly destructive?: boolean;
  readonly unavailable?: LibraryMenuUnavailable;
  readonly key?: LibraryObjectKey;
}

/** Пункты группами: между группами меню рисует разделитель. */
export type LibraryMenu = readonly (readonly LibraryMenuItem[])[];

/** Меню презентации: на главной и на странице проекта, в карточке и в строке. */
export function deckMenu(deckId: string): LibraryMenu {
  const href = deckHref(deckId);
  return [
    [
      { id: 'open', href, key: 'Enter' },
      { id: 'openInNewTab', href },
      { id: 'present', href: presentHref(deckId) },
    ],
    [
      { id: 'rename', key: 'F2' },
      // Куда переносить, меню узнаёт само: список проектов — у всего раздела (`moveTargets`).
      { id: 'moveToProject' },
      { id: 'copyLink', href },
    ],
    [{ id: 'delete', destructive: true, key: 'Delete' }],
  ];
}

/**
 * Меню чата в истории боковой панели: открыть ведёт в чат, показ — колоды, которую ведёт чат
 * (пока её нет, пункта нет). Переименование, перенос и удаление — чата вместе с его колодами.
 */
export function chatMenu(chatId: string, deckId: string | null): LibraryMenu {
  const href = chatHref(chatId);
  return [
    [
      { id: 'open', href, key: 'Enter' },
      { id: 'openInNewTab', href },
      ...(deckId === null ? [] : [{ id: 'present' as const, href: presentHref(deckId) }]),
    ],
    [{ id: 'rename', key: 'F2' }, { id: 'moveToProject' }, { id: 'copyLink', href }],
    [{ id: 'delete', destructive: true, key: 'Delete' }],
  ];
}

/** Строка подменю «Переместить в проект»: проект или «Без проекта» (`project: null`). */
export interface MoveTarget<P> {
  readonly project: P | null;
  /** Презентация уже здесь: строка отмечена галочкой и не выбирается. */
  readonly current: boolean;
}

/**
 * Подменю «Переместить в проект»: проекты в переданном порядке, «Без проекта» — последней
 * строкой. Отмечено ровно то место, где презентация сейчас. Если её проекта в списке нет
 * (его только что удалили), не отмечено ничего: перенести можно куда угодно.
 */
export function moveTargets<P extends { readonly projectId: string }>(
  projects: readonly P[],
  currentProjectId: string | null,
): readonly MoveTarget<P>[] {
  return [
    ...projects.map((project) => ({ project, current: project.projectId === currentProjectId })),
    { project: null, current: currentProjectId === null },
  ];
}

/**
 * Меню проекта. `current` — меню в шапке страницы самого проекта: «Открыть» там незачем,
 * а клавиш объекта нет — в шапке проект не элемент списка, на котором стоит фокус.
 */
export function projectMenu(
  projectId: string,
  { current = false, pinned = false }: { current?: boolean; pinned?: boolean } = {},
): LibraryMenu {
  const href = projectHref(projectId);
  const key = (value: LibraryObjectKey): Pick<LibraryMenuItem, 'key'> =>
    current ? {} : { key: value };
  const open: readonly LibraryMenuItem[] = current ? [] : [{ id: 'open', href, ...key('Enter') }];
  return [
    [
      ...open,
      { id: 'openInNewTab', href },
      { id: 'newDeck', href: newDeckInProjectHref(projectId) },
    ],
    [
      { id: pinned ? 'unpin' : 'pin' },
      { id: 'rename', ...key('F2') },
      { id: 'appearance' },
      { id: 'copyLink', href },
    ],
    // Прикрепляют шаблон на вкладке «Шаблоны»: там и загрузка файла, и выбор из загруженных.
    [{ id: 'attachTemplate', href: projectTemplatesHref(projectId) }],
    [{ id: 'delete', destructive: true, ...key('Delete') }],
  ];
}

/** Нажатая клавиша — только то, что нужно для решения. */
export interface ObjectKeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * Что делает клавиша, пока фокус на объекте: F2 — переименовать, Delete или Backspace (на Mac
 * клавиша «delete» — это Backspace) — удалить. С модификаторами клавиши не наши: их оставляем
 * браузеру и системе. Действие должно быть в меню и доступно — иначе клавиша ничего не делает.
 */
export function objectKeyAction(
  event: ObjectKeyEvent,
  menu: LibraryMenu,
): 'rename' | 'delete' | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  const wanted =
    event.key === 'F2'
      ? 'rename'
      : event.key === 'Delete' || event.key === 'Backspace'
        ? 'delete'
        : null;
  if (wanted === null) return null;
  const item = menu.flat().find((entry) => entry.id === wanted);
  return item && item.unavailable === undefined && item.key !== undefined ? wanted : null;
}

/** Подпись клавиши у пункта: так же, как в меню редактора. */
export function objectKeyLabel(key: LibraryObjectKey): string {
  return key === 'Delete' ? 'Del' : key;
}
