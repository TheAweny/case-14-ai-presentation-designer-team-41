'use client';

import {
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  deleteBrandbookAction,
  updateBrandbookAction,
  type LibraryActionResult,
} from '@/app/(library)/actions';
import { apiFetch } from '@/lib/api';
import { useLibraryNotice } from '@/components/library/library-notices';
import { ConfirmDeleteDialog, RenameDialog } from '@/components/library/object-dialogs';
import { fontStackOf } from '@/components/library/template-swatch';
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
import {
  BRANDBOOK_FILE_ACCEPT,
  brandbookAssetUrl,
  brandbookCoverAsset,
  brandbookOverview,
  parseBrandbookUpload,
  type LibraryBrandbook,
} from '@/lib/brandbooks';
import { cn } from '@/lib/utils';

const FAILED: LibraryActionResult = { ok: false, reason: 'invalid' };
const BRANDBOOK_NAME_MAX_LENGTH = 200;

/** Адрес страницы «Шаблоны» с раскрытым брендбуком. */
export const brandbookHref = (brandbookId: string | null) =>
  brandbookId === null
    ? '/templates#brandbooks'
    : `/templates?brandbook=${encodeURIComponent(brandbookId)}#brandbooks`;

type FailureKey = '400' | '413' | '422' | 'server' | 'timeout' | 'other';
function failureKey(status: number | null): FailureKey {
  if (status === 400 || status === 413 || status === 422) return String(status) as FailureKey;
  if (status === 504) return 'timeout';
  if (status !== null && status >= 500) return 'server';
  return 'other';
}

/**
 * Загрузка брендбука в библиотеку. Движок разбирает файл, пока идёт запрос; разобранный
 * брендбук сразу раскрывается на странице.
 */
export function BrandbookUpload({ className }: { className?: string }) {
  const t = useTranslations('brandbooksPage');
  const router = useRouter();
  const notice = useLibraryNotice();
  const input = useRef<HTMLInputElement>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    const problem = !BRANDBOOK_FILE_ACCEPT.split(',').includes(extension)
      ? t('wrongType')
      : file.size === 0
        ? t('emptyFile')
        : null;
    if (problem) {
      setError(problem);
      notice.alert(problem);
      return;
    }
    setError(null);
    setRunning(file.name);
    const body = new FormData();
    body.set('file', file);
    void apiFetch('/files/brandbook', { method: 'POST', body })
      .then(async (response) => {
        if (!response.ok) throw response.status;
        const uploaded = parseBrandbookUpload(await response.json());
        notice.status(t('uploaded', { name: uploaded.fileName }));
        router.replace(brandbookHref(uploaded.fileId), { scroll: false });
        router.refresh();
      })
      .catch((failure: unknown) => {
        const message = t(`failed.${failureKey(typeof failure === 'number' ? failure : null)}`);
        setError(message);
        notice.alert(message);
      })
      .finally(() => setRunning(null));
  };

  return (
    <div className={cn('flex flex-col items-stretch gap-1.5 sm:items-end', className)}>
      <input
        ref={input}
        type="file"
        accept={BRANDBOOK_FILE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={choose}
      />
      <Button
        type="button"
        variant="outline"
        disabled={running !== null}
        onClick={() => input.current?.click()}
      >
        {running !== null ? (
          <SpinnerIcon className="animate-spin motion-reduce:animate-none" />
        ) : (
          <UploadIcon />
        )}
        {running !== null ? t('uploading', { name: running }) : t('upload')}
      </Button>
      {error ? (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-destructive sm:max-w-80">
          <WarningIcon size={14} className="shrink-0" />
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground sm:max-w-80 sm:text-right">{t('uploadHint')}</p>
      )}
    </div>
  );
}

type Patch = { brandbookId: string; removed?: boolean; name?: string; shared?: boolean };

/**
 * Брендбуки библиотеки сеткой карточек, как шаблоны: щелчок раскрывает разбор брендбука под
 * сеткой, меню «⋯» и правая кнопка — переименовать, открыть всем (администратору) и удалить.
 */
export function BrandbookLibrary({
  brandbooks,
  selectedId,
  panel,
  canShare,
}: {
  brandbooks: readonly LibraryBrandbook[];
  selectedId: string | null;
  panel: ReactNode;
  canShare: boolean;
}) {
  const t = useTranslations('brandbooksPage');
  const router = useRouter();
  const notice = useLibraryNotice();
  const [, startTransition] = useTransition();
  const [shown, change] = useOptimistic(brandbooks, (current, patch: Patch) =>
    current.flatMap((brandbook) => {
      if (brandbook.brandbookId !== patch.brandbookId) return [brandbook];
      if (patch.removed) return [];
      return [
        {
          ...brandbook,
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.shared === undefined ? {} : { shared: patch.shared }),
        },
      ];
    }),
  );
  const [dialog, setDialog] = useState<{
    kind: 'rename' | 'delete';
    brandbook: LibraryBrandbook;
  } | null>(null);

  const run = (
    patch: Patch,
    action: () => Promise<LibraryActionResult>,
    messages: { ok?: string; failed: string },
  ) => {
    startTransition(async () => {
      change(patch);
      const result = await action().catch(() => FAILED);
      if (!result.ok) notice.alert(messages.failed);
      else if (messages.ok) notice.status(messages.ok);
      if (result.ok && patch.removed && patch.brandbookId === selectedId) {
        router.replace(brandbookHref(null), { scroll: false });
      }
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <ul
        aria-label={t('label')}
        className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,12rem),1fr))] gap-3"
      >
        {shown.map((brandbook) => {
          const editable = brandbook.mine || canShare;
          return (
            <li key={brandbook.brandbookId} className="min-w-0">
              <BrandbookCard
                brandbook={brandbook}
                selected={brandbook.brandbookId === selectedId}
                onSelect={() =>
                  router.replace(
                    brandbookHref(
                      brandbook.brandbookId === selectedId ? null : brandbook.brandbookId,
                    ),
                    { scroll: false },
                  )
                }
                onRename={editable ? () => setDialog({ kind: 'rename', brandbook }) : null}
                onShare={
                  canShare
                    ? () =>
                        run(
                          { brandbookId: brandbook.brandbookId, shared: !brandbook.shared },
                          () =>
                            updateBrandbookAction(brandbook.brandbookId, {
                              shared: !brandbook.shared,
                            }),
                          {
                            ok: t(brandbook.shared ? 'unsharedNotice' : 'sharedNotice', {
                              name: brandbook.name,
                            }),
                            failed: t('shareFailed'),
                          },
                        )
                    : null
                }
                onRemove={editable ? () => setDialog({ kind: 'delete', brandbook }) : null}
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
        value={dialog?.brandbook.name ?? ''}
        maxLength={BRANDBOOK_NAME_MAX_LENGTH}
        onSave={(name) => {
          const brandbook = dialog?.brandbook;
          if (!brandbook || name === null || name === brandbook.name) return;
          run(
            { brandbookId: brandbook.brandbookId, name },
            () => updateBrandbookAction(brandbook.brandbookId, { name }),
            { failed: t('renameFailed') },
          );
        }}
        onCloseAutoFocus={() => undefined}
      />
      <ConfirmDeleteDialog
        open={dialog?.kind === 'delete'}
        onOpenChange={(open) => (open ? null : setDialog(null))}
        title={t('deleteTitle')}
        body={t(dialog?.brandbook.shared ? 'deleteSharedBody' : 'deleteBody', {
          name: dialog?.brandbook.name ?? '',
        })}
        confirmLabel={t('deleteConfirm')}
        onConfirm={() => {
          const brandbook = dialog?.brandbook;
          if (!brandbook) return;
          run(
            { brandbookId: brandbook.brandbookId, removed: true },
            () => deleteBrandbookAction(brandbook.brandbookId),
            { ok: t('deleted', { name: brandbook.name }), failed: t('deleteFailed') },
          );
        }}
        onCloseAutoFocus={() => undefined}
      />
    </div>
  );
}

/**
 * Обложка брендбука в пропорциях слайда: фон и текст в цветах брендбука, «Аа» его шрифтом,
 * логотип, если его можно показать, и полоска палитры.
 */
export function BrandbookCover({
  brandbook,
  className,
}: {
  brandbook: LibraryBrandbook;
  className?: string;
}) {
  const overview = brandbookOverview(brandbook.profile);
  const cover = brandbookCoverAsset(brandbook.profile);
  const font = overview.fonts[0]?.family;
  const palette = overview.colors.slice(0, 6);
  const style: CSSProperties = {
    aspectRatio: '16 / 9',
    fontFamily: font ? fontStackOf(font) : undefined,
  };
  return (
    <span
      aria-hidden
      className={cn(
        'relative block overflow-hidden rounded-md bg-muted ring-1 ring-border',
        className,
      )}
      style={style}
    >
      <span className="absolute top-2.5 left-3 text-2xl leading-none font-semibold text-foreground/80">
        Aa
      </span>
      {cover ? (
        <img
          src={brandbookAssetUrl(brandbook.brandbookId, cover.id)}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-y-3 right-3 max-w-[55%] object-contain"
          style={{ height: 'calc(100% - 2.25rem)' }}
        />
      ) : null}
      {palette.length > 0 ? (
        <span className="absolute inset-x-3 bottom-2.5 flex h-2 overflow-hidden rounded-full ring-1 ring-foreground/10">
          {palette.map((color) => (
            <span key={color.hex} className="flex-1" style={{ backgroundColor: `#${color.hex}` }} />
          ))}
        </span>
      ) : null}
    </span>
  );
}

function BrandbookCard({
  brandbook,
  selected,
  onSelect,
  onRename,
  onShare,
  onRemove,
}: {
  brandbook: LibraryBrandbook;
  selected: boolean;
  onSelect: () => void;
  onRename: (() => void) | null;
  onShare: (() => void) | null;
  onRemove: (() => void) | null;
}) {
  const t = useTranslations('brandbooksPage');
  const overview = brandbookOverview(brandbook.profile);
  const hasMenu = onRename !== null || onShare !== null || onRemove !== null;
  const items = (
    Item: typeof DropdownMenuItem | typeof ContextMenuItem,
    Separator: typeof DropdownMenuSeparator | typeof ContextMenuSeparator,
  ) => (
    <>
      {onRename ? <Item onSelect={onRename}>{t('rename')}</Item> : null}
      {onShare ? (
        <Item onSelect={onShare}>{brandbook.shared ? t('unshare') : t('share')}</Item>
      ) : null}
      {onRemove ? (
        <>
          {onRename || onShare ? <Separator /> : null}
          <Item variant="destructive" onSelect={onRemove}>
            {t('delete')}
          </Item>
        </>
      ) : null}
    </>
  );

  const card = (
    <div className="group/brandbook relative">
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
        <BrandbookCover brandbook={brandbook} className="w-full" />
        <span className="flex min-w-0 flex-col gap-1 px-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium">{brandbook.name}</span>
            {brandbook.shared ? (
              <span className="shrink-0 rounded-full px-1.5 py-px text-[0.6875rem] text-muted-foreground ring-1 ring-border">
                {t('sharedBadge')}
              </span>
            ) : null}
            {brandbook.profile.status === 'partial' ? (
              <span className="shrink-0 rounded-full px-1.5 py-px text-[0.6875rem] text-muted-foreground ring-1 ring-border">
                {t('partialBadge')}
              </span>
            ) : null}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {t('summary', { colors: overview.colors.length, fonts: overview.fonts.length })}
          </span>
        </span>
      </button>
      {hasMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label={t('menu', { name: brandbook.name })}
              className="absolute top-3 right-3 size-7 opacity-0 shadow-sm group-hover/brandbook:opacity-100 group-focus-within/brandbook:opacity-100 pointer-coarse:opacity-100 [@media(hover:none)]:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
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

  if (!hasMenu) return card;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {items(ContextMenuItem, ContextMenuSeparator)}
      </ContextMenuContent>
    </ContextMenu>
  );
}
