'use client';

import {
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  deleteTemplateAction,
  updateTemplateAction,
  type LibraryActionResult,
} from '@/app/(library)/actions';
import { templateImports, useTemplateImport } from '@/components/assistant/session';
import { useLibraryNotice } from '@/components/library/library-notices';
import { ConfirmDeleteDialog, RenameDialog } from '@/components/library/object-dialogs';
import { PaletteStrip } from '@/components/library/template-swatch';
import { TemplateCover, type TemplateThumb } from '@/components/project/template-thumb';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreIcon, SpinnerIcon, UploadIcon, WarningIcon } from '@/components/ui/icons';
import { TEMPLATE_EXTENSIONS, templateFileProblem } from '@/lib/deck-generator';
import { cn } from '@/lib/utils';

const FAILED: LibraryActionResult = { ok: false, reason: 'invalid' };
const TEMPLATE_NAME_MAX_LENGTH = 200;

/** Шаблон библиотеки на странице «Шаблоны». */
export interface LibraryTemplate extends TemplateThumb {
  /** Администратор открыл шаблон всем аккаунтам. */
  readonly shared: boolean;
  /** Шаблон загрузил этот аккаунт. */
  readonly mine: boolean;
}

/** Адрес страницы с раскрытым профилем шаблона. */
export const templateHref = (templateId: string | null) =>
  templateId === null ? '/templates' : `/templates?template=${encodeURIComponent(templateId)}`;

/**
 * Загрузка шаблона в библиотеку: файл разбирает движок, ход виден на кнопке. Разобранный
 * шаблон раскрывается на странице.
 */
export function TemplateUpload({ className }: { className?: string }) {
  const t = useTranslations('templatesPage');
  const router = useRouter();
  const notice = useLibraryNotice();
  const input = useRef<HTMLInputElement>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const item = useTemplateImport(importId);
  const done = useRef<string | null>(null);

  // Разбор закончился — шаблон в библиотеке: раскрыть его, ровно один раз.
  useEffect(() => {
    if (item?.phase !== 'done' || !item.result || done.current === item.importId) return;
    done.current = item.importId;
    const { templateId, fileName } = item.result;
    notice.status(t('uploaded', { name: fileName }));
    setImportId(null);
    router.replace(templateHref(templateId), { scroll: false });
    router.refresh();
  }, [item, notice, router, t]);

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const problem = templateFileProblem(file);
    if (problem) {
      notice.alert(t(problem === 'type' ? 'wrongType' : 'emptyFile'));
      return;
    }
    setImportId(templateImports.start(file));
  };

  const running = item?.phase === 'running';
  const failed = item?.phase === 'failed';
  return (
    <div className={cn('flex flex-col items-stretch gap-1.5 sm:items-end', className)}>
      <input
        ref={input}
        type="file"
        accept={TEMPLATE_EXTENSIONS.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={choose}
      />
      <Button type="button" disabled={running} onClick={() => input.current?.click()}>
        {running ? <SpinnerIcon className="animate-spin" /> : <UploadIcon />}
        {running ? t('uploading', { name: item.file.name }) : t('upload')}
      </Button>
      {failed ? (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-destructive">
          <WarningIcon size={14} />
          {item.failure?.message || t('uploadFailed')}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{t('uploadHint')}</p>
      )}
    </div>
  );
}

/**
 * Библиотека шаблонов: свои и общие. Щелчок раскрывает профиль шаблона под сеткой, меню «⋯» и
 * правая кнопка — переименовать, открыть всем (администратору) и удалить. Удалённый шаблон
 * пропадает сразу, до ответа сервера; не вышло — возвращается, и уведомление объясняет почему.
 */
export function TemplateLibrary({
  templates,
  selectedId,
  panel,
  canShare,
}: {
  templates: readonly LibraryTemplate[];
  selectedId: string | null;
  /** Профиль раскрытого шаблона, нарисованный сервером. */
  panel: ReactNode;
  /** Аккаунт — администратор: может открыть шаблон всем и править общие. */
  canShare: boolean;
}) {
  const t = useTranslations('templatesPage');
  const router = useRouter();
  const notice = useLibraryNotice();
  const [, startTransition] = useTransition();
  const [shown, change] = useOptimistic(
    templates,
    (current, patch: { templateId: string; removed?: boolean; name?: string; shared?: boolean }) =>
      current.flatMap((template) => {
        if (template.templateId !== patch.templateId) return [template];
        if (patch.removed) return [];
        return [
          {
            ...template,
            ...(patch.name === undefined ? {} : { fileName: patch.name }),
            ...(patch.shared === undefined ? {} : { shared: patch.shared }),
          },
        ];
      }),
  );
  const [dialog, setDialog] = useState<{
    kind: 'rename' | 'delete';
    template: LibraryTemplate;
  } | null>(null);

  const run = (
    patch: { templateId: string; removed?: boolean; name?: string; shared?: boolean },
    action: () => Promise<LibraryActionResult>,
    messages: { ok?: string; failed: string },
  ) => {
    startTransition(async () => {
      change(patch);
      const result = await action().catch(() => FAILED);
      if (!result.ok) notice.alert(messages.failed);
      else if (messages.ok) notice.status(messages.ok);
      if (result.ok && patch.removed && patch.templateId === selectedId) {
        router.replace(templateHref(null), { scroll: false });
      }
    });
  };

  const rename = (template: LibraryTemplate, name: string | null) => {
    if (name === null || name === template.fileName) return;
    run(
      { templateId: template.templateId, name },
      () => updateTemplateAction(template.templateId, { name }),
      { failed: t('renameFailed') },
    );
  };

  const share = (template: LibraryTemplate, shared: boolean) =>
    run(
      { templateId: template.templateId, shared },
      () => updateTemplateAction(template.templateId, { shared }),
      {
        ok: t(shared ? 'sharedNotice' : 'unsharedNotice', { name: template.fileName }),
        failed: t('shareFailed'),
      },
    );

  const remove = (template: LibraryTemplate) =>
    run(
      { templateId: template.templateId, removed: true },
      () => deleteTemplateAction(template.templateId),
      { ok: t('deleted', { name: template.fileName }), failed: t('deleteFailed') },
    );

  return (
    <div className="flex flex-col gap-8">
      <ul
        aria-label={t('label')}
        className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,12rem),1fr))] gap-3"
      >
        {shown.map((template) => {
          const editable = template.mine || canShare;
          const actions = {
            rename: editable ? () => setDialog({ kind: 'rename', template }) : null,
            share: canShare ? () => share(template, !template.shared) : null,
            remove: editable ? () => setDialog({ kind: 'delete', template }) : null,
          };
          return (
            <li key={template.templateId} className="min-w-0">
              <TemplateCard
                template={template}
                selected={template.templateId === selectedId}
                onSelect={() =>
                  router.replace(
                    templateHref(template.templateId === selectedId ? null : template.templateId),
                    { scroll: false },
                  )
                }
                actions={actions}
              />
            </li>
          );
        })}
      </ul>
      {panel}
      <RenameDialog
        open={dialog?.kind === 'rename'}
        onOpenChange={(open) => (open ? null : setDialog(null))}
        title={t('renameTitle')}
        label={t('renameLabel')}
        value={dialog?.template.fileName ?? ''}
        maxLength={TEMPLATE_NAME_MAX_LENGTH}
        onSave={(name) => dialog && rename(dialog.template, name)}
        onCloseAutoFocus={() => undefined}
      />
      <ConfirmDeleteDialog
        open={dialog?.kind === 'delete'}
        onOpenChange={(open) => (open ? null : setDialog(null))}
        title={t('deleteTitle')}
        body={t(dialog?.template.shared ? 'deleteSharedBody' : 'deleteBody', {
          name: dialog?.template.fileName ?? '',
        })}
        confirmLabel={t('deleteConfirm')}
        onConfirm={() => dialog && remove(dialog.template)}
        onCloseAutoFocus={() => undefined}
      />
    </div>
  );
}

interface CardActions {
  readonly rename: (() => void) | null;
  readonly share: (() => void) | null;
  readonly remove: (() => void) | null;
}

/** Карточка шаблона: титульный макет, имя, число макетов, палитра и отметка «Общий». */
function TemplateCard({
  template,
  selected,
  onSelect,
  actions,
}: {
  template: LibraryTemplate;
  selected: boolean;
  onSelect: () => void;
  actions: CardActions;
}) {
  const t = useTranslations('templatesPage');
  const hasActions = actions.rename || actions.share || actions.remove;
  const items = (
    Item: typeof DropdownMenuItem | typeof ContextMenuItem,
    Separator: typeof DropdownMenuSeparator | typeof ContextMenuSeparator,
  ) => (
    <>
      {actions.rename ? <Item onSelect={actions.rename}>{t('rename')}</Item> : null}
      {actions.share ? (
        <Item onSelect={actions.share}>{t(template.shared ? 'unshare' : 'share')}</Item>
      ) : null}
      {actions.remove ? (
        <>
          <Separator />
          <Item variant="destructive" onSelect={actions.remove}>
            {t('delete')}
          </Item>
        </>
      ) : null}
    </>
  );

  const card = (
    <div className="group/template relative">
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          'flex w-full flex-col gap-2 rounded-xl p-2 text-left ring-1 ring-border outline-none',
          'transition-colors duration-100 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50',
          'motion-reduce:transition-none',
          selected && 'bg-muted/60 ring-2 ring-foreground/40',
        )}
      >
        <TemplateCover template={template} className="w-full" />
        <span className="flex min-w-0 flex-col gap-1 px-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium">{template.fileName}</span>
            {template.shared ? (
              <span className="shrink-0 rounded-full px-1.5 py-px text-[0.6875rem] text-muted-foreground ring-1 ring-border">
                {t('sharedBadge')}
              </span>
            ) : null}
          </span>
          <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
            {t('layouts', { count: template.layoutCount })}
            <PaletteStrip system={template.designSystem} className="h-2 w-16" />
          </span>
        </span>
      </button>
      {hasActions ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label={t('menu', { name: template.fileName })}
              className="absolute top-3 right-3 size-7 opacity-0 shadow-sm group-hover/template:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreIcon size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {items(DropdownMenuItem, DropdownMenuSeparator)}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );

  if (!hasActions) return card;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {items(ContextMenuItem, ContextMenuSeparator)}
      </ContextMenuContent>
    </ContextMenu>
  );
}
