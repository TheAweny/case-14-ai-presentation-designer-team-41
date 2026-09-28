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
  deleteDeckAction,
  moveDeckAction,
  updateDeckAction,
  type LibraryActionResult,
} from '@/app/(library)/actions';
import { useLibraryNotice } from '@/components/library/library-notices';
import { useLibraryProjects, type LibraryProject } from '@/components/library/library-projects';
import { ConfirmDeleteDialog, RenameDialog } from '@/components/library/object-dialogs';
import { focusObject, removalFocusTarget } from '@/components/library/object-focus';
import { ObjectMenu, type DeckMove, type ObjectMenuAction } from '@/components/library/object-menu';
import { deckMenu, moveTargets } from '@/lib/library-menu';
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
  projectId,
  title,
  layout,
  children,
}: {
  deckId: string;
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
  const menu = useMemo(() => deckMenu(deckId), [deckId]);
  const projects = useLibraryProjects();

  const rename = (next: string | null) => {
    if (next === null) return;
    startTransition(async () => {
      show({ title: next });
      const result = await updateDeckAction(deckId, { title: next }).catch(() => FAILED);
      if (!result.ok) notice.alert(t('notices.renameDeckFailed'));
    });
  };

  const remove = () => {
    const removedTitle = shown.title;
    focusNext.current = removalFocusTarget(root.current);
    startTransition(async () => {
      show({ removed: true });
      const result = await deleteDeckAction(deckId).catch(() => FAILED);
      if (result.ok) notice.status(t('notices.deckDeleted', { title: removedTitle }));
      else notice.alert(t('notices.deleteDeckFailed'));
    });
  };

  const moveTo = (project: LibraryProject | null) => {
    startTransition(async () => {
      const result = await moveDeckAction(deckId, project?.projectId ?? null).catch(() => FAILED);
      if (!result.ok) notice.alert(t('notices.moveDeckFailed'));
      else if (project) notice.status(t('notices.deckMoved', { project: project.name }));
      else notice.status(t('notices.deckMovedOut'));
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
        label={t('deckMenu', { title: shown.title })}
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
        title={t('renameDeck.title')}
        label={t('renameDeck.label')}
        value={shown.title}
        maxLength={DECK_TITLE_MAX_LENGTH}
        onSave={rename}
        onCloseAutoFocus={restoreFocus}
      />
      <ConfirmDeleteDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => setDialog(open ? 'delete' : null)}
        title={t('deleteDeck.title')}
        body={t('deleteDeck.body', { title: shown.title })}
        confirmLabel={t('deleteDeck.confirm')}
        onConfirm={remove}
        onCloseAutoFocus={restoreFocus}
      />
    </DeckTitleContext>
  );
}
