import { describe, expect, it } from 'vitest';
import {
  deckHref,
  deckMenu,
  isPresentRequested,
  moveTargets,
  newDeckInProjectHref,
  objectKeyAction,
  objectKeyLabel,
  presentHref,
  projectHref,
  projectMenu,
  type LibraryMenu,
  type ObjectKeyEvent,
} from './library-menu';

const ids = (menu: LibraryMenu) => menu.map((group) => group.map((item) => item.id));
const item = (menu: LibraryMenu, id: string) => menu.flat().find((entry) => entry.id === id);
const press = (key: string, modifiers: Partial<ObjectKeyEvent> = {}): ObjectKeyEvent => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
});

describe('адреса объектов', () => {
  it('кодирует id в адресе', () => {
    expect(deckHref('a b/c')).toBe('/decks/a%20b%2Fc');
    expect(projectHref('a b')).toBe('/projects/a%20b');
    expect(newDeckInProjectHref('a&b')).toBe('/projects/a%26b?compose=1');
  });

  it('показ — тот же адрес колоды с ?present=1, и его узнаёт редактор', () => {
    const href = presentHref('pitch');
    expect(href).toBe('/decks/pitch?present=1');
    const value = new URL(href, 'http://localhost').searchParams.get('present') ?? undefined;
    expect(isPresentRequested(value)).toBe(true);
  });

  it('показ начинается только на явное 1', () => {
    for (const value of [undefined, '', '0', 'true', ['1']]) {
      expect(isPresentRequested(value)).toBe(false);
    }
  });
});

describe('deckMenu', () => {
  const menu = deckMenu('pitch');

  it('пункты в порядке меню, удаление — отдельной группой в конце', () => {
    expect(ids(menu)).toEqual([
      ['open', 'openInNewTab', 'present'],
      ['rename', 'moveToProject', 'copyLink'],
      ['delete'],
    ]);
  });

  it('перенос в проект — подменю без адреса и без клавиши', () => {
    expect(item(menu, 'moveToProject')).toEqual({ id: 'moveToProject' });
  });

  it('все пункты доступны; разрушительное — только удаление', () => {
    expect(menu.flat().every((entry) => entry.unavailable === undefined)).toBe(true);
    expect(
      menu
        .flat()
        .filter((entry) => entry.destructive)
        .map((entry) => entry.id),
    ).toEqual(['delete']);
  });

  it('ведёт в редактор, в новую вкладку и в показ; ссылка — адрес редактора', () => {
    expect(item(menu, 'open')?.href).toBe('/decks/pitch');
    expect(item(menu, 'openInNewTab')?.href).toBe('/decks/pitch');
    expect(item(menu, 'present')?.href).toBe('/decks/pitch?present=1');
    expect(item(menu, 'copyLink')?.href).toBe('/decks/pitch');
  });

  it('клавиши — только у открытия, переименования и удаления', () => {
    const keys = menu.flat().flatMap((entry) => (entry.key ? [[entry.id, entry.key]] : []));
    expect(keys).toEqual([
      ['open', 'Enter'],
      ['rename', 'F2'],
      ['delete', 'Delete'],
    ]);
  });
});

describe('moveTargets', () => {
  const projects = [{ projectId: 'lct' }, { projectId: 'sales' }];
  const rows = (current: string | null) =>
    moveTargets(projects, current).map((row) => [row.project?.projectId ?? null, row.current]);

  it('проекты в порядке списка, «Без проекта» — последней строкой', () => {
    expect(rows('lct')).toEqual([
      ['lct', true],
      ['sales', false],
      [null, false],
    ]);
  });

  it('презентация вне проектов — отмечена строка «Без проекта»', () => {
    expect(rows(null)).toEqual([
      ['lct', false],
      ['sales', false],
      [null, true],
    ]);
  });

  it('проекта презентации нет в списке — не отмечено ничего', () => {
    expect(rows('gone').every(([, current]) => current === false)).toBe(true);
  });

  it('без проектов остаётся одна строка «Без проекта»', () => {
    expect(moveTargets([], null)).toEqual([{ project: null, current: true }]);
  });

  it('отдаёт те же объекты проектов, что получил', () => {
    expect(moveTargets(projects, null)[1]?.project).toBe(projects[1]);
  });
});

describe('projectMenu', () => {
  it('в сайдбаре и на карточке: открыть, новая презентация, правки, ссылка, шаблон, удаление', () => {
    expect(ids(projectMenu('sales'))).toEqual([
      ['open', 'openInNewTab', 'newDeck'],
      ['pin', 'rename', 'appearance', 'copyLink'],
      ['attachTemplate'],
      ['delete'],
    ]);
  });

  it('у закреплённого проекта пункт снимает закрепление, а не ставит его ещё раз', () => {
    expect(item(projectMenu('sales', { pinned: true }), 'unpin')).toBeDefined();
    expect(item(projectMenu('sales', { pinned: true }), 'pin')).toBeUndefined();
    expect(item(projectMenu('sales', { current: true, pinned: true }), 'open')).toBeUndefined();
  });

  it('«Прикрепить шаблон» ведёт на вкладку шаблонов проекта; неактивных пунктов нет', () => {
    const menu = projectMenu('sales');
    expect(item(menu, 'attachTemplate')?.href).toBe('/projects/sales?tab=templates');
    expect(menu.flat().filter((entry) => entry.unavailable !== undefined)).toEqual([]);
  });

  it('новая презентация открывает поле генерации на странице проекта', () => {
    expect(item(projectMenu('sales'), 'newDeck')?.href).toBe('/projects/sales?compose=1');
    expect(item(projectMenu('sales'), 'open')?.href).toBe('/projects/sales');
  });

  it('в шапке самого проекта нет «Открыть» и нет клавиш объекта', () => {
    const menu = projectMenu('sales', { current: true });
    expect(item(menu, 'open')).toBeUndefined();
    expect(menu.flat().some((entry) => entry.key !== undefined)).toBe(false);
    expect(item(menu, 'delete')?.destructive).toBe(true);
    expect(item(menu, 'attachTemplate')?.href).toBe('/projects/sales?tab=templates');
  });
});

describe('objectKeyAction', () => {
  const menu = deckMenu('pitch');

  it('F2 — переименовать, Delete и Backspace — удалить', () => {
    expect(objectKeyAction(press('F2'), menu)).toBe('rename');
    expect(objectKeyAction(press('Delete'), menu)).toBe('delete');
    expect(objectKeyAction(press('Backspace'), menu)).toBe('delete');
  });

  it('с модификаторами и прочие клавиши — не наши', () => {
    expect(objectKeyAction(press('Delete', { shiftKey: true }), menu)).toBeNull();
    expect(objectKeyAction(press('Backspace', { metaKey: true }), menu)).toBeNull();
    expect(objectKeyAction(press('F2', { ctrlKey: true }), menu)).toBeNull();
    expect(objectKeyAction(press('F2', { altKey: true }), menu)).toBeNull();
    expect(objectKeyAction(press('Enter'), menu)).toBeNull();
    expect(objectKeyAction(press('a'), menu)).toBeNull();
  });

  it('клавиша без подсказки в меню ничего не делает', () => {
    const header = projectMenu('sales', { current: true });
    expect(objectKeyAction(press('F2'), header)).toBeNull();
    expect(objectKeyAction(press('Delete'), header)).toBeNull();
    expect(objectKeyAction(press('F2'), projectMenu('sales'))).toBe('rename');
  });

  it('подписи клавиш — как в меню редактора', () => {
    expect(objectKeyLabel('Delete')).toBe('Del');
    expect(objectKeyLabel('F2')).toBe('F2');
    expect(objectKeyLabel('Enter')).toBe('Enter');
  });
});
