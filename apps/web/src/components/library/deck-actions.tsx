'use client';

import {
  createContext,
  useContext,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import {
  deleteChatAction,
  deleteDeckAction,
  moveDeckAction,
  updateChatAction,
  updateDeckAction,
  type LibraryActionResult,
} from '@/app/(library)/actions';
import { useLibraryNotice } from '@/components/library/library-notices';
import { useLibraryProjects, type LibraryProject } from '@/components/library/library-projects';
import { ConfirmDeleteDialog, RenameDialog } from '@/components/library/object-dialogs';
import { focusObject, removalFocusTarget } from '@/components/library/object-focus';
import { ObjectMenu, type DeckMove, type ObjectMenuAction } from '@/components/library/object-menu';
import { chatMenu, deckMenu, moveTargets } from '@/lib/library-menu';
import { DECK_TITLE_MAX_LENGTH } from '@/lib/library-source';

/** Название, которое видно сейчас: после переименования — новое, ещё до ответа сервера. */
const DeckTitleContext = createContext<string | null>(null);

/**
 * Название презентации в карточке или строке. Карточку рисует сервер, а новое название
 * известно только здесь, на клиенте: компонент берёт его из `DeckActions`, если тот есть выше.
 */
export function DeckTitle({ children }: { children: string }) {
  return useContext(DeckTitleContext) ?? children;
}

const FAILED: LibraryActionResult = { ok: false, reason: 'invalid' };

type Dialog = 'rename' | 'delete' | null;

/** Строки меню: у презентации и у чата они свои, остальное меню общее. */
const DECK_TEXTS = {
  menu: 'deckMenu',
  renameFailed: 'notices.renameDeckFailed',
  deleted: 'notices.deckDeleted',
  deleteFailed: 'notices.deleteDeckFailed',
  moved: 'notices.deckMoved',
  movedOut: 'notices.deckMovedOut',
  moveFailed: 'notices.moveDeckFailed',
  renameTitle: 'renameDeck.title',
  renameLabel: 'renameDeck.label',
  deleteTitle: 'deleteDeck.title',
  deleteBody: 'deleteDeck.body',
  deleteConfirm: 'deleteDeck.confirm',
} as const;

const CHAT_TEXTS = {
  menu: 'chatMenu',
  renameFailed: 'notices.renameChatFailed',
  deleted: 'notices.chatDeleted',
  deleteFailed: 'notices.deleteChatFailed',
  moved: 'notices.chatMoved',
  movedOut: 'notices.chatMovedOut',
  moveFailed: 'notices.moveChatFailed',
  renameTitle: 'renameChat.title',
  renameLabel: 'renameChat.label',
  deleteTitle: 'deleteChat.title',
  deleteBody: 'deleteChat.body',
  deleteConfirm: 'deleteChat.confirm',
} as const satisfies Record<keyof typeof DECK_TEXTS, string>;

/**
 * Где стоит кнопка «⋯»: на карточке — в углу обложки, в строке — справа по центру,
 * в боковой панели — компактная, без своей плашки: строка и так высотой в одну строку.
 */
const BUTTON_PLACE = {
  card: 'top-3 right-3',
  row: 'top-1/2 right-2 -translate-y-1/2 sm:right-3',
  sidebar:
    'top-1/2 right-0.5 size-6 -translate-y-1/2 bg-transparent shadow-none ring-0 backdrop-blur-none',
} as const;

/**
 * Меню презентации вокруг её карточки или строки: открыть, показ, переименовать, перенести в
 * проект, ссылка, удалить. Переименование и удаление видны сразу (`useOptimistic`); если сервер
 * не принял, всё возвращается как было, и внизу появляется объяснение. Перенос оптимистично не
 * показываем: карточка переезжает, когда страница перерисуется с ответом сервера.
 */
export function DeckActions({
  deckId,
  chatId,
  projectId,
  title,
  layout,
  children,
}: {
  /** Колода; у чата — та, которую он ведёт, или null, пока колоды нет. */
  deckId: string | null;
  /**
   * Меню чата, а не колоды: открывается чат, а переименование, перенос и удаление — чата
   * вместе с собранными в нём колодами.
   */
  chatId?: string;
  /** Проект, где презентация сейчас; null — вне проектов. Его строка в подменю отмечена. */
  projectId: string | null;
  title: string;
  layout: keyof typeof BUTTON_PLACE;
  /** Сама карточка или строка — ссылка в редактор. */
  children: ReactNode;
}) {
  const t = useTranslations('libraryMenu');
  const notice = useLibraryNotice();
  const [, startTransition] = useTransition();
  const [shown, show] = useOptimistic<
    { title: string; removed: boolean },
    Partial<{ title: string; removed: boolean }>
  >({ title, removed: false }, (current, patch) => ({ ...current, ...patch }));
  const [dialog, setDialog] = useState<Dialog>(null);
  const root = useRef<HTMLDivElement>(null);
  /** Куда уйдёт фокус, когда закроется диалог удаления; null — обратно на объект. */
  const focusNext = useRef<HTMLElement | null>(null);
  const menu = useMemo(
    () => (chatId !== undefined ? chatMenu(chatId, deckId) : deckMenu(deckId ?? '')),
    [chatId, deckId],
  );
  const texts = chatId !== undefined ? CHAT_TEXTS : DECK_TEXTS;
  const projects = useLibraryProjects();

  const rename = (next: string | null) => {
    if (next === null) return;
    startTransition(async () => {
      show({ title: next });
      const result = await (
        chatId !== undefined
          ? updateChatAction(chatId, { title: next })
          : updateDeckAction(deckId ?? '', { title: next })
      ).catch(() => FAILED);
      if (!result.ok) notice.alert(t(texts.renameFailed));
    });
  };

  const remove = () => {
    const removedTitle = shown.title;
    focusNext.current = removalFocusTarget(root.current);
    startTransition(async () => {
      show({ removed: true });
      const result = await (
        chatId !== undefined ? deleteChatAction(chatId) : deleteDeckAction(deckId ?? '')
      ).catch(() => FAILED);
      if (result.ok) notice.status(t(texts.deleted, { title: removedTitle }));
      else notice.alert(t(texts.deleteFailed));
    });
  };

  const moveTo = (project: LibraryProject | null) => {
    startTransition(async () => {
      const target = project?.projectId ?? null;
      const result = await (
        chatId !== undefined
          ? updateChatAction(chatId, { projectId: target })
          : moveDeckAction(deckId ?? '', target)
      ).catch(() => FAILED);
      if (!result.ok) notice.alert(t(texts.moveFailed));
      else if (project) notice.status(t(texts.moved, { project: project.name }));
      else notice.status(t(texts.movedOut));
    });
  };

  const move: DeckMove = { targets: moveTargets(projects, projectId), onMove: moveTo };

  const onAction = (action: ObjectMenuAction) => {
    if (action === 'rename' || action === 'delete') setDialog(action);
  };

  const restoreFocus = (event: Event) => {
    event.preventDefault();
    const next = focusNext.current;
    focusNext.current = null;
    if (next) next.focus();
    else focusObject(root.current);
  };

  return (
    <DeckTitleContext value={shown.title}>
      <ObjectMenu
        kind="deck"
        menu={menu}
        label={t(texts.menu, { title: shown.title })}
        onAction={onAction}
        move={move}
        removed={shown.removed}
        rootRef={root}
        buttonClassName={BUTTON_PLACE[layout]}
      >
        {children}
      </ObjectMenu>
      <RenameDialog
        open={dialog === 'rename'}
        onOpenChange={(open) => setDialog(open ? 'rename' : null)}
        title={t(texts.renameTitle)}
        label={t(texts.renameLabel)}
        value={shown.title}
        maxLength={DECK_TITLE_MAX_LENGTH}
        onSave={rename}
        onCloseAutoFocus={restoreFocus}
      />
      <ConfirmDeleteDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => setDialog(open ? 'delete' : null)}
        title={t(texts.deleteTitle)}
        body={t(texts.deleteBody, { title: shown.title })}
        confirmLabel={t(texts.deleteConfirm)}
        onConfirm={remove}
        onCloseAutoFocus={restoreFocus}
      />
    </DeckTitleContext>
  );
}
