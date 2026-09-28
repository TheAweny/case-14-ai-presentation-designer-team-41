'use client';

import { useMemo, useRef, useState, type RefObject } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { MoreIcon, PlusIcon } from '@/components/ui/icons';
import { InlineNameInput } from '@/components/library/inline-name-input';
import { ConfirmDeleteDialog } from '@/components/library/object-dialogs';
import {
  DROPDOWN_MENU_KIT,
  LibraryMenuItems,
  useLibraryMenuSelect,
  type ObjectMenuAction,
} from '@/components/library/object-menu';
import { useProjectEditing, type ProjectFailure } from '@/components/library/project-actions';
import { ProjectAppearancePicker } from '@/components/library/project-appearance-picker';
import { ProjectIcon } from '@/components/library/project-icon';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { projectMenu } from '@/lib/library-menu';
import { PROJECT_NAME_MAX_LENGTH } from '@/lib/library-source';
import type { ProjectAppearance } from '@/lib/project-appearance';
import { cn } from '@/lib/utils';

/** Строка меты под именем. Собрана на сервере: относительное время считается там один раз. */
export interface ProjectHeaderMeta {
  /** Сколько шаблонов прикреплено к проекту: «2 шаблона» или «Без шаблона». */
  readonly templates: string;
  readonly decks: string;
  readonly edited: string;
  readonly editedIso: string;
}

/**
 * Шапка страницы проекта: иконка — кнопка выбора иконки и цвета, имя правится по месту, под
 * ним число шаблонов и презентаций и время правки. Справа — новая презентация и меню «⋯»
 * с тем же списком действий, что у проекта в сайдбаре и на главной.
 *
 * Правки сохраняются сразу и видны до ответа сервера (`useProjectEditing`). Если не вышло —
 * вернётся прежнее значение и под заголовком появится объяснение.
 */
export function ProjectHeader({
  projectId,
  name,
  appearance,
  deckCount,
  pinned,
  meta,
  newDeckHref,
}: {
  projectId: string;
  name: string;
  appearance: ProjectAppearance;
  /** Сколько презентаций удалится вместе с проектом: это говорит подтверждение. */
  deckCount: number;
  pinned: boolean;
  meta: ProjectHeaderMeta;
  newDeckHref: string;
}) {
  const t = useTranslations('projectPage');
  const tMenu = useTranslations('libraryMenu');
  const [failure, setFailure] = useState<ProjectFailure | null>(null);
  const editing = useProjectEditing({ projectId, name, appearance, pinned }, setFailure);
  const { shown } = editing;
  const [renaming, setRenaming] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  const onAction = (action: ObjectMenuAction) => {
    if (action === 'rename') setRenaming(true);
    else if (action === 'appearance') setPickerOpen(true);
    else if (action === 'pin') editing.setPinned(true);
    else if (action === 'unpin') editing.setPinned(false);
    else if (action === 'delete') setDeleting(true);
  };

  const failureMessage = {
    rename: t('header.renameFailed'),
    appearance: t('header.appearanceFailed'),
    pin: t('header.pinFailed'),
    delete: tMenu('notices.deleteProjectFailed'),
  } satisfies Record<ProjectFailure, string>;

  return (
    <TooltipProvider>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3 sm:gap-4">
          <ProjectAppearancePicker
            value={shown.appearance}
            onChange={editing.changeAppearance}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
          >
            <button
              type="button"
              aria-label={t('header.appearance', { project: shown.name })}
              title={t('header.menuAppearance')}
              className={cn(
                'shrink-0 rounded-xl outline-none',
                'transition-[box-shadow] duration-100 motion-reduce:transition-none',
                'hover:ring-2 hover:ring-foreground/15 focus-visible:ring-2 focus-visible:ring-ring',
                'aria-expanded:ring-2 aria-expanded:ring-foreground/25',
              )}
            >
              <ProjectIcon appearance={shown.appearance} size="lg" />
            </button>
          </ProjectAppearancePicker>

          <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
            <h1 className="min-w-0 text-2xl font-semibold tracking-tight">
              {renaming ? (
                <InlineNameInput
                  name={shown.name}
                  label={t('header.renameLabel')}
                  maxLength={PROJECT_NAME_MAX_LENGTH}
                  onDone={(next) => {
                    setRenaming(false);
                    if (next !== null) editing.rename(next);
                  }}
                  className={cn(
                    '-mx-1.5 h-9 w-[calc(100%+0.75rem)] max-w-xl rounded-md bg-background px-1.5',
                    'text-2xl font-semibold tracking-tight text-foreground ring-1 ring-ring outline-none',
                  )}
                />
              ) : (
                // Как в Figma и ChatGPT: щелчок по имени — сразу правка.
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setRenaming(true)}
                      className={cn(
                        '-mx-1.5 max-w-full rounded-md px-1.5 text-left break-words outline-none',
                        'transition-colors duration-100 motion-reduce:transition-none',
                        'hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
                      )}
                    >
                      {shown.name}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t('header.rename')}</TooltipContent>
                </Tooltip>
              )}
            </h1>
            <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-muted-foreground">
              <span className="tabular-nums">{meta.templates}</span>
              <span aria-hidden>·</span>
              <span className="tabular-nums">{meta.decks}</span>
              <span aria-hidden>·</span>
              <time dateTime={meta.editedIso}>{meta.edited}</time>
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 max-sm:pl-15">
          <Button asChild size="lg">
            <Link href={newDeckHref}>
              <PlusIcon data-icon="inline-start" />
              {t('newDeck')}
            </Link>
          </Button>
          <ProjectMenu
            projectId={projectId}
            projectName={shown.name}
            pinned={shown.pinned}
            buttonRef={menuButton}
            onAction={onAction}
          />
        </div>
      </header>
      {failure ? (
        <p role="alert" className="-mt-2 text-sm text-destructive">
          {failureMessage[failure]}
        </p>
      ) : null}
      <ConfirmDeleteDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={tMenu('deleteProject.title')}
        body={tMenu('deleteProject.body', { name: shown.name, count: deckCount })}
        confirmLabel={tMenu('deleteProject.confirm')}
        // Проект удаляют с его же страницы: действие уведёт на главную.
        onConfirm={() => editing.remove({ leave: true })}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          menuButton.current?.focus();
        }}
      />
    </TooltipProvider>
  );
}

/**
 * Меню «⋯» — тот же список действий, что у проекта в сайдбаре и на главной, только без
 * «Открыть»: проект уже открыт. Переименование, иконка и удаление открываются, когда меню уже
 * закрылось: иначе меню, возвращая фокус своей кнопке, отняло бы его у поля или у панели.
 */
function ProjectMenu({
  projectId,
  projectName,
  pinned,
  buttonRef,
  onAction,
}: {
  projectId: string;
  projectName: string;
  pinned: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onAction: (action: ObjectMenuAction) => void;
}) {
  const t = useTranslations('libraryMenu');
  const menu = useMemo(
    () => projectMenu(projectId, { current: true, pinned }),
    [projectId, pinned],
  );
  const { select, closeAutoFocus } = useLibraryMenuSelect(onAction);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={buttonRef}
          variant="ghost"
          size="icon-lg"
          aria-label={t('projectMenu', { name: projectName })}
        >
          <MoreIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-60"
        onCloseAutoFocus={(event) => closeAutoFocus(event)}
      >
        <LibraryMenuItems kind="project" menu={menu} kit={DROPDOWN_MENU_KIT} onSelect={select} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
