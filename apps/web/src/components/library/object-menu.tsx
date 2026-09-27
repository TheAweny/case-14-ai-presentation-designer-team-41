'use client';

import {
  Fragment,
  useCallback,
  useRef,
  type ComponentType,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  AddFileIcon,
  CheckIcon,
  DeleteIcon,
  EditIcon,
  LinkIcon,
  MoreIcon,
  MoveIcon,
  NoFolderIcon,
  OpenFolderIcon,
  OpenIcon,
  OpenInNewTabIcon,
  PaletteIcon,
  PlayIcon,
  UploadIcon,
  type Icon,
} from '@/components/ui/icons';
import { useLibraryNotice } from '@/components/library/library-notices';
import type { LibraryProject } from '@/components/library/library-projects';
import { focusObject } from '@/components/library/object-focus';
import { ProjectIcon } from '@/components/library/project-icon';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  objectKeyAction,
  objectKeyLabel,
  type LibraryMenu,
  type LibraryMenuItem,
  type MoveTarget,
} from '@/lib/library-menu';
import { cn } from '@/lib/utils';

export type ObjectKind = 'deck' | 'project';

/**
 * Действия, которые открывают что-то своё — диалог, поле имени, выбор иконки. Их выполняет
 * владелец объекта, и только когда меню уже закрылось: иначе меню, возвращая фокус, отняло бы
 * его у поля или диалога.
 */
export type ObjectMenuAction = 'rename' | 'appearance' | 'delete';

const ICONS: Readonly<Record<LibraryMenuItem['id'], Icon>> = {
  open: OpenIcon,
  openInNewTab: OpenInNewTabIcon,
  present: PlayIcon,
  newDeck: AddFileIcon,
  rename: EditIcon,
  moveToProject: MoveIcon,
  appearance: PaletteIcon,
  copyLink: LinkIcon,
  attachTemplate: UploadIcon,
  delete: DeleteIcon,
};

/** Презентация открывается в редактор, проект — как папка. */
const iconOf = (kind: ObjectKind, id: LibraryMenuItem['id']) =>
  id === 'open' && kind === 'project' ? OpenFolderIcon : ICONS[id];

/** Что нужно пункту от меню Radix: у контекстного и выпадающего меню эти свойства общие. */
interface KitItemProps {
  variant?: 'default' | 'destructive';
  disabled?: boolean;
  'aria-disabled'?: boolean;
  'aria-current'?: boolean;
  className?: string;
  onSelect?: (event: Event) => void;
  children?: ReactNode;
}

/** Из чего собирать пункты: контекстное меню или выпадающее. Пункты одни и те же. */
export interface MenuKit {
  readonly Item: ComponentType<KitItemProps>;
  readonly Separator: ComponentType;
  readonly Shortcut: ComponentType<{ children?: ReactNode }>;
  readonly Sub: ComponentType<{ children?: ReactNode }>;
  readonly SubTrigger: ComponentType<{ children?: ReactNode }>;
  readonly SubContent: ComponentType<{ className?: string; children?: ReactNode }>;
}

export const CONTEXT_MENU_KIT: MenuKit = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Shortcut: ContextMenuShortcut,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};

export const DROPDOWN_MENU_KIT: MenuKit = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Shortcut: DropdownMenuShortcut,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};

/**
 * Подменю «Переместить в проект»: куда можно перенести и что сделать по выбору. Без него пункт
 * не рисуется — меню проекта его не передаёт.
 */
export interface DeckMove {
  readonly targets: readonly MoveTarget<LibraryProject>[];
  /** `null` — вынести из проектов. */
  readonly onMove: (project: LibraryProject | null) => void;
}

/**
 * Выполнение пунктов меню. Переходы, новая вкладка и буфер обмена — сразу, в том же жесте:
 * браузер пускает в новую вкладку и в буфер только по нему. Остальное (`ObjectMenuAction`)
 * откладывается до закрытия меню: `closeAutoFocus` отдаёт его владельцу.
 */
export function useLibraryMenuSelect(onAction: (action: ObjectMenuAction) => void) {
  const router = useRouter();
  const t = useTranslations('libraryMenu.notices');
  const notice = useLibraryNotice();
  const pending = useRef<ObjectMenuAction | null>(null);
  /** Меню закрылось щелчком мимо: фокус остаётся там, куда щёлкнули. */
  const outside = useRef(false);

  const copyLink = useCallback(
    async (href: string) => {
      try {
        await navigator.clipboard.writeText(new URL(href, window.location.origin).href);
        notice.status(t('linkCopied'));
      } catch {
        notice.alert(t('linkFailed'));
      }
    },
    [notice, t],
  );

  const select = (item: LibraryMenuItem, event: Event) => {
    if (item.unavailable !== undefined) {
      // Неактивный пункт меню не закрывает: пояснение рядом, его дочитывают.
      event.preventDefault();
      return;
    }
    switch (item.id) {
      case 'open':
      case 'present':
      case 'newDeck':
      case 'attachTemplate':
        if (item.href) router.push(item.href);
        return;
      case 'openInNewTab':
        if (item.href) window.open(item.href, '_blank', 'noopener');
        return;
      case 'copyLink':
        if (item.href) void copyLink(item.href);
        return;
      case 'rename':
      case 'appearance':
      case 'delete':
        pending.current = item.id;
        return;
      case 'moveToProject':
        return;
    }
  };

  /**
   * Для `onCloseAutoFocus` меню. Отложенное действие — владельцу. Без него `restore` решает,
   * вернуть ли фокус на объект: контекстное меню своей кнопки не имеет, и без этого фокус
   * ушёл бы на страницу.
   */
  const closeAutoFocus = (event: Event, restore?: () => void) => {
    const action = pending.current;
    const wasOutside = outside.current;
    pending.current = null;
    outside.current = false;
    if (action) {
      event.preventDefault();
      onAction(action);
      return;
    }
    if (restore && !wasOutside) {
      event.preventDefault();
      restore();
    }
  };

  const interactOutside = () => {
    outside.current = true;
  };

  return { select, closeAutoFocus, interactOutside };
}

/** Пункты меню группами, с разделителями. Одинаково для контекстного и выпадающего меню. */
export function LibraryMenuItems({
  kind,
  menu,
  kit,
  move,
  onSelect,
}: {
  kind: ObjectKind;
  menu: LibraryMenu;
  kit: MenuKit;
  move?: DeckMove;
  onSelect: (item: LibraryMenuItem, event: Event) => void;
}) {
  const t = useTranslations('libraryMenu');
  const { Item, Separator, Shortcut } = kit;
  return menu.map((group, index) => (
    <Fragment key={group[0]?.id ?? index}>
      {index > 0 ? <Separator /> : null}
      {group.map((item) => {
        if (item.id === 'moveToProject') {
          return move ? <MoveSubmenu key={item.id} kit={kit} move={move} /> : null;
        }
        const label =
          item.id === 'delete'
            ? t(kind === 'deck' ? 'items.deleteDeck' : 'items.deleteProject')
            : t(`items.${item.id}`);
        const unavailable = item.unavailable !== undefined;
        const ItemIcon = iconOf(kind, item.id);
        return (
          <Item
            key={item.id}
            variant={item.destructive ? 'destructive' : 'default'}
            // Не `disabled`: такой пункт Radix пропускает стрелками, и пояснение не прочитать.
            aria-disabled={unavailable || undefined}
            className={cn(unavailable && 'cursor-default items-start')}
            onSelect={(event) => onSelect(item, event)}
          >
            <ItemIcon className={cn(unavailable && 'mt-0.5 opacity-50')} />
            {item.unavailable !== undefined ? (
              <span className="flex min-w-0 flex-col">
                <span className="opacity-50">{label}</span>
                <span className="text-[0.6875rem] text-muted-foreground">
                  {t(`unavailable.${item.unavailable}`)}
                </span>
              </span>
            ) : (
              label
            )}
            {item.key ? <Shortcut>{objectKeyLabel(item.key)}</Shortcut> : null}
          </Item>
        );
      })}
    </Fragment>
  ));
}

/**
 * Подменю «Переместить в проект»: проекты с их иконками и «Без проекта» под чертой. Место, где
 * презентация сейчас, отмечено галочкой и не выбирается — переносить туда нечего. Выбор
 * выполняется сразу: он ничего не открывает, и ждать закрытия меню незачем.
 */
function MoveSubmenu({ kit, move }: { kit: MenuKit; move: DeckMove }) {
  const t = useTranslations('libraryMenu');
  const { Item, Separator, Sub, SubTrigger, SubContent } = kit;
  const projects = move.targets.filter((target) => target.project !== null);
  const none = move.targets.find((target) => target.project === null);

  const row = ({ project, current }: MoveTarget<LibraryProject>) => (
    <Item
      key={project?.projectId ?? 'none'}
      disabled={current}
      aria-current={current || undefined}
      onSelect={() => move.onMove(project)}
    >
      {project ? (
        // Иконка проекта — в размер остальных иконок меню.
        <ProjectIcon appearance={project.appearance} size="sm" className="size-3.5" />
      ) : (
        <NoFolderIcon />
      )}
      <span className="min-w-0 truncate">{project ? project.name : t('move.none')}</span>
      {current ? <CheckIcon aria-hidden className="ml-auto" /> : null}
    </Item>
  );

  return (
    <Sub>
      <SubTrigger>
        <MoveIcon />
        {t('items.moveToProject')}
      </SubTrigger>
      {/* Проектов бывает много: подменю прокручивается, а не уходит за край экрана. */}
      <SubContent className="max-h-80 w-56 overflow-y-auto">
        {projects.map(row)}
        {projects.length > 0 ? <Separator /> : null}
        {none ? row(none) : null}
      </SubContent>
    </Sub>
  );
}

/**
 * Объект главного меню с меню действий: правая кнопка (и клавиша меню или Shift+F10 — их даёт
 * Radix) и кнопка «⋯». Кнопка видна при наведении и когда фокус внутри объекта, а на сенсорном
 * экране — всегда: навести там нечем.
 *
 * Меню перехватывает правую кнопку только над самим объектом. Пока фокус на объекте, F2 и
 * Delete делают то же, что пункты «Переименовать» и «Удалить».
 */
export function ObjectMenu({
  kind,
  menu,
  label,
  onAction,
  move,
  removed = false,
  disabled = false,
  rootRef,
  className,
  buttonClassName,
  children,
}: {
  kind: ObjectKind;
  menu: LibraryMenu;
  /** Подпись кнопки «⋯»: «Действия с презентацией „…“». */
  label: string;
  onAction: (action: ObjectMenuAction) => void;
  /** Подменю переноса — только у презентации. */
  move?: DeckMove;
  /** Объект уже удалён и ждёт ответа сервера: из списка он пропадает сразу. */
  removed?: boolean;
  /** Меню выключено: например, пока имя правится по месту и в поле нужно системное меню. */
  disabled?: boolean;
  rootRef?: Ref<HTMLDivElement>;
  className?: string;
  /** Где стоит кнопка «⋯» над объектом. */
  buttonClassName?: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement | null>(null);
  const context = useLibraryMenuSelect(onAction);
  const dropdown = useLibraryMenuSelect(onAction);

  const setRoot = (node: HTMLDivElement | null) => {
    root.current = node;
    if (typeof rootRef === 'function') rootRef(node);
    else if (rootRef) rootRef.current = node;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // События из порталов (меню, диалоги) React доносит сюда же: их не трогаем.
    const target = event.target;
    if (!(target instanceof Element) || !event.currentTarget.contains(target)) return;
    if (target.closest('input, textarea, [contenteditable="true"]')) return;
    const action = objectKeyAction(event, menu);
    if (!action) return;
    event.preventDefault();
    onAction(action);
  };

  const onContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    // Правая кнопка в открытом «⋯» — тоже из портала: там своего меню не открываем.
    const target = event.target;
    if (!(target instanceof Node) || !event.currentTarget.contains(target)) event.preventDefault();
  };

  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild disabled={disabled || removed}>
        <div
          ref={setRoot}
          // Метки для `object-focus`: по ним ищут соседа, когда объект удаляют.
          data-object=""
          data-removed={removed ? '' : undefined}
          hidden={removed}
          onKeyDown={onKeyDown}
          onContextMenu={onContextMenu}
          className={cn('group/object relative min-w-0', className)}
        >
          {children}
          {disabled ? null : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={label}
                  className={cn(
                    'absolute grid size-7 place-items-center rounded-md outline-none',
                    'bg-popover/90 text-muted-foreground shadow-sm ring-1 ring-border backdrop-blur-sm',
                    'hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                    'aria-expanded:text-foreground',
                    // Скрыта, пока не нужна; на сенсорном экране навести нечем — видна всегда.
                    'opacity-0 transition-opacity duration-100 motion-reduce:transition-none',
                    'group-focus-within/object:opacity-100 group-hover/object:opacity-100',
                    'pointer-coarse:opacity-100 aria-expanded:opacity-100',
                    buttonClassName,
                  )}
                >
                  <MoreIcon size={16} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-60"
                onCloseAutoFocus={(event) => dropdown.closeAutoFocus(event)}
              >
                <LibraryMenuItems
                  kind={kind}
                  menu={menu}
                  kit={DROPDOWN_MENU_KIT}
                  move={move}
                  onSelect={dropdown.select}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        className="w-60"
        onInteractOutside={context.interactOutside}
        onCloseAutoFocus={(event) => context.closeAutoFocus(event, () => focusObject(root.current))}
      >
        <LibraryMenuItems
          kind={kind}
          menu={menu}
          kit={CONTEXT_MENU_KIT}
          move={move}
          onSelect={context.select}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
