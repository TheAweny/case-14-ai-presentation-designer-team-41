'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  deleteProjectAction,
  updateProjectAction,
  type LibraryActionResult,
} from '@/app/(library)/actions';
import { useLibraryNotice } from '@/components/library/library-notices';
import { ConfirmDeleteDialog, RenameDialog } from '@/components/library/object-dialogs';
import { focusObject, removalFocusTarget } from '@/components/library/object-focus';
import { ObjectMenu, type ObjectMenuAction } from '@/components/library/object-menu';
import { ProjectAppearancePicker } from '@/components/library/project-appearance-picker';
import { ProjectIcon, type ProjectIconSize } from '@/components/library/project-icon';
import { PinIcon } from '@/components/ui/icons';
import type { InlineNameEnd } from '@/components/library/inline-name-input';
import { projectHref, projectMenu } from '@/lib/library-menu';
import { PROJECT_NAME_MAX_LENGTH, type ProjectSummary } from '@/lib/library-source';
import type { ProjectAppearance } from '@/lib/project-appearance';

/** Что меню проекта знает о нём. Шаблон и его профиль сюда не нужны — и на клиент не едут. */
export type ProjectMenuTarget = Pick<
  ProjectSummary,
  'projectId' | 'name' | 'appearance' | 'deckCount' | 'pinned'
>;

interface Shown {
  readonly name: string;
  readonly appearance: ProjectAppearance;
  readonly pinned: boolean;
  readonly removed: boolean;
}

/** Что не удалось сохранить: от этого зависит текст ошибки. */
export type ProjectFailure = 'rename' | 'appearance' | 'pin' | 'delete';

const FAILURE_TEXT = {
  rename: 'renameProjectFailed',
  appearance: 'appearanceFailed',
  pin: 'pinFailed',
  delete: 'deleteProjectFailed',
} as const satisfies Record<ProjectFailure, string>;

const FAILED: LibraryActionResult = { ok: false, reason: 'invalid' };

/**
 * Правки проекта: имя, иконка и цвет, удаление. Видны сразу (`useOptimistic`); когда действие
 * закончилось, страница уже перерисована с новыми данными, а если не вышло — вернётся прежнее
 * значение. Об ошибке по умолчанию говорит уведомление внизу; `report` заменяет его своим
 * местом (шапка проекта пишет под заголовком) и получает null, когда начинается новая правка.
 */
export function useProjectEditing(
  {
    projectId,
    name,
    appearance,
    pinned,
  }: Pick<ProjectMenuTarget, 'projectId' | 'name' | 'appearance' | 'pinned'>,
  report?: (failure: ProjectFailure | null) => void,
) {
  const t = useTranslations('libraryMenu.notices');
  const notice = useLibraryNotice();
  const [, startTransition] = useTransition();
  const [shown, show] = useOptimistic<Shown, Partial<Shown>>(
    { name, appearance, pinned, removed: false },
    (current, patch) => ({ ...current, ...patch }),
  );

  const fail = (failure: ProjectFailure) => {
    if (report) report(failure);
    else notice.alert(t(FAILURE_TEXT[failure]));
  };

  const save = (patch: { name?: string; appearance?: ProjectAppearance }, kind: ProjectFailure) => {
    report?.(null);
    startTransition(async () => {
      show(patch);
      const result = await updateProjectAction(projectId, patch).catch(() => FAILED);
      if (!result.ok) fail(kind);
    });
  };

  return {
    shown,
    rename(next: string) {
      if (next !== shown.name) save({ name: next }, 'rename');
    },
    changeAppearance(next: ProjectAppearance) {
      if (next.icon === shown.appearance.icon && next.color === shown.appearance.color) return;
      save({ appearance: next }, 'appearance');
    },
    setPinned(next: boolean) {
      if (next === shown.pinned) return;
      report?.(null);
      startTransition(async () => {
        show({ pinned: next });
        const result = await updateProjectAction(projectId, { pinned: next }).catch(() => FAILED);
        if (!result.ok) fail('pin');
      });
    },
    /** `leave` — человек на странице этого проекта: действие уведёт его на главную. */
    remove({ leave }: { leave: boolean }) {
      const removedName = shown.name;
      report?.(null);
      startTransition(async () => {
        show({ removed: true });
        // Действие с переходом отвечает не значением, а переходом: это тоже успех.
        const result: LibraryActionResult | undefined = await deleteProjectAction(projectId, {
          leave,
        }).catch(() => FAILED);
        if (result === undefined || result.ok) {
          notice.status(t('projectDeleted', { name: removedName }));
        } else {
          fail('delete');
        }
      });
    },
  };
}

const ShownContext = createContext<Pick<Shown, 'name' | 'appearance' | 'pinned'> | null>(null);

/** Имя проекта в карточке, которую рисует сервер: новое имя известно только на клиенте. */
export function ProjectName({ children }: { children: string }) {
  return useContext(ShownContext)?.name ?? children;
}

/** Иконка проекта в карточке: после смены иконки — новая, ещё до ответа сервера. */
/** Значок закрепления на карточке: после закрепления виден сразу, ещё до ответа сервера. */
export function ProjectPinMark({ pinned }: { pinned: boolean }) {
  const t = useTranslations('library');
  const shown = useContext(ShownContext);
  if (!(shown?.pinned ?? pinned)) return null;
  return (
    <span title={t('pinnedMark')} className="inline-flex shrink-0 text-muted-foreground">
      <PinIcon size={12} aria-hidden />
      <span className="sr-only">{t('pinnedMark')}</span>
    </span>
  );
}

export function ProjectLook({
  appearance,
  size,
  className,
}: {
  appearance: ProjectAppearance;
  size?: ProjectIconSize;
  className?: string;
}) {
  const shown = useContext(ShownContext);
  return (
    <ProjectIcon appearance={shown?.appearance ?? appearance} size={size} className={className} />
  );
}

/** Что пункт сайдбара рисует, пока имя правится по месту. */
export interface InlineRename {
  readonly renaming: boolean;
  readonly name: string;
  readonly finish: (next: string | null, end: InlineNameEnd) => void;
}

/**
 * Меню проекта вокруг его карточки или пункта сайдбара. Переименование — диалогом в карточке
 * и по месту в сайдбаре (`children` — функция, которая рисует поле вместо ссылки). Иконка и
 * цвет выбираются на панели у самого объекта.
 */
export function ProjectActions({
  project,
  rename: renameMode,
  className,
  buttonClassName,
  children,
}: {
  project: ProjectMenuTarget;
  rename: 'dialog' | 'inline';
  className?: string;
  buttonClassName?: string;
  children: ReactNode | ((inline: InlineRename) => ReactNode);
}) {
  const t = useTranslations('libraryMenu');
  const pathname = usePathname();
  const editing = useProjectEditing(project);
  const { shown } = editing;
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const focusNext = useRef<HTMLElement | null>(null);
  /** Поле имени закрыли с клавиатуры: когда вернётся ссылка, фокус — на неё. */
  const refocus = useRef(false);
  const menu = useMemo(
    () => projectMenu(project.projectId, { pinned: shown.pinned }),
    [project.projectId, shown.pinned],
  );

  useEffect(() => {
    if (renaming || !refocus.current) return;
    refocus.current = false;
    focusObject(root.current);
  }, [renaming]);

  const onAction = (action: ObjectMenuAction) => {
    if (action === 'appearance') setPickerOpen(true);
    else if (action === 'pin') editing.setPinned(true);
    else if (action === 'unpin') editing.setPinned(false);
    else if (action === 'rename' && renameMode === 'inline') setRenaming(true);
    else if (action === 'rename' || action === 'delete') setDialog(action);
  };

  const remove = () => {
    focusNext.current = removalFocusTarget(root.current);
    editing.remove({ leave: pathname === projectHref(project.projectId) });
  };

  const restoreFocus = (event: Event) => {
    event.preventDefault();
    const next = focusNext.current;
    focusNext.current = null;
    if (next) next.focus();
    else focusObject(root.current);
  };

  const inline: InlineRename = {
    renaming,
    name: shown.name,
    finish: (next, end) => {
      refocus.current = end === 'keyboard';
      setRenaming(false);
      if (next !== null) editing.rename(next);
    },
  };

  return (
    <ShownContext value={{ name: shown.name, appearance: shown.appearance, pinned: shown.pinned }}>
      <ObjectMenu
        kind="project"
        menu={menu}
        label={t('projectMenu', { name: shown.name })}
        onAction={onAction}
        removed={shown.removed}
        disabled={renaming}
        rootRef={root}
        className={className}
        buttonClassName={buttonClassName}
      >
        {typeof children === 'function' ? children(inline) : children}
      </ObjectMenu>
      <ProjectAppearancePicker
        value={shown.appearance}
        onChange={editing.changeAppearance}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        anchorRef={root}
        onCloseAutoFocus={restoreFocus}
      />
      <RenameDialog
        open={dialog === 'rename'}
        onOpenChange={(open) => setDialog(open ? 'rename' : null)}
        title={t('renameProject.title')}
        label={t('renameProject.label')}
        value={shown.name}
        maxLength={PROJECT_NAME_MAX_LENGTH}
        onSave={(next) => {
          if (next !== null) editing.rename(next);
        }}
        onCloseAutoFocus={restoreFocus}
      />
      <ConfirmDeleteDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => setDialog(open ? 'delete' : null)}
        title={t('deleteProject.title')}
        body={t('deleteProject.body', { name: shown.name, count: project.deckCount })}
        confirmLabel={t('deleteProject.confirm')}
        onConfirm={remove}
        onCloseAutoFocus={restoreFocus}
      />
    </ShownContext>
  );
}
