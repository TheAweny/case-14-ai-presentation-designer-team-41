'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useRouter } from '@bprogress/next/app';
import { useTranslations } from 'next-intl';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  Clock01Icon,
  CodeIcon,
  Copy01Icon,
  Download04Icon,
  FileAddIcon,
  FileUploadIcon,
  Globe02Icon,
  Folder01Icon,
  Image01Icon,
  Pdf01Icon,
  PencilEdit01Icon,
  PlayIcon,
  Ppt01Icon,
  Settings01Icon,
} from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ExportFormat } from '@/lib/deck-export';
import { NEW_DECK_HREF } from '@/lib/library-menu';
import { keepCanvasFocus, useMenuFocus } from '@/components/editor/chrome-focus';
import { shortcutText } from '@/components/editor/editor-shortcuts';
import { openSettings, useIsMac } from '@/components/settings/open-settings';

/**
 * Полоса над холстом: слева название колоды с меню файла, справа показ и экспорт.
 *
 * Действие, которому ещё нечем работать, не прячется, а показано неактивным с объяснением:
 * место в интерфейсе у него уже есть, и человек видит, чего ждать.
 */
export function FileBar({
  title,
  onRename,
  onPresent,
  onExport,
  exportPercent = null,
}: {
  title: string;
  onRename: (title: string) => void;
  /** Начать показ с открытого слайда. Без него кнопка неактивна. */
  onPresent?: () => void;
  /** Открыть экспорт, в выбранном формате или в последнем. Без него кнопка неактивна. */
  onExport?: (format?: ExportFormat) => void;
  /** Экспорт идёт: сколько процентов готово. Кнопка показывает их, пока окно свёрнуто. */
  exportPercent?: number | null;
}) {
  const t = useTranslations('fileBar');
  const [renaming, setRenaming] = useState(false);

  return (
    <TooltipProvider>
      <div
        role="toolbar"
        aria-label={t('label')}
        className="flex h-11 shrink-0 items-center gap-2 px-3"
      >
        <div className="flex min-w-0 flex-1 items-center gap-0.5">
          <FileMenu title={title} onRename={() => setRenaming(true)} onExport={onExport} />
          {renaming ? (
            <RenameInput
              title={title}
              onDone={(next) => {
                setRenaming(false);
                if (next !== null) onRename(next);
              }}
            />
          ) : (
            // Как в Figma: щелчок по названию — сразу правка, меню — отдельной кнопкой.
            <WithTooltip label={t('rename')}>
              <Button
                variant="ghost"
                className="min-w-0 max-w-full px-2 text-foreground"
                onMouseDown={keepCanvasFocus}
                onClick={() => setRenaming(true)}
              >
                <span className="truncate">{title}</span>
              </Button>
            </WithTooltip>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-card p-1 shadow-sm shadow-black/20 ring-1 ring-border">
          <BarButton
            icon={PlayIcon}
            label={t('present')}
            pending={t('presentPending')}
            onClick={onPresent}
          />
          <BarButton
            icon={Download04Icon}
            label={
              exportPercent === null ? t('export') : t('exportRunning', { percent: exportPercent })
            }
            pending={t('exportPending')}
            onClick={onExport ? () => onExport() : undefined}
            primary
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

function FileMenu({
  title,
  onRename,
  onExport,
}: {
  title: string;
  onRename: () => void;
  onExport?: (format?: ExportFormat) => void;
}) {
  const t = useTranslations('fileBar');
  const focus = useMenuFocus();
  const exportAs = (format: ExportFormat) => (onExport ? () => onExport(format) : undefined);
  const renameAsked = useRef(false);
  const settingsAsked = useRef(false);
  const router = useRouter();
  const mac = useIsMac();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          aria-label={t('fileMenu', { title })}
          className="gap-0.5 px-1.5 text-muted-foreground hover:text-foreground"
          onMouseDown={keepCanvasFocus}
          {...focus.trigger}
        >
          <HugeiconsIcon icon={Folder01Icon} strokeWidth={1.5} />
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            strokeWidth={1.5}
            className="text-muted-foreground"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-64"
        onCloseAutoFocus={(event) => {
          if (renameAsked.current) {
            // Поле названия открываем только теперь: пока меню закрывалось, оно держало фокус
            // у себя, и поле, открытое раньше, оставалось без него.
            renameAsked.current = false;
            event.preventDefault();
            onRename();
            return;
          }
          if (settingsAsked.current) {
            // Окно настроек открываем, когда меню уже вернуло фокус: иначе меню забрало бы его
            // у окна, закрываясь.
            settingsAsked.current = false;
            event.preventDefault();
            openSettings();
            return;
          }
          focus.onCloseAutoFocus(event);
        }}
      >
        <MenuItem icon={ArrowLeft01Icon} label={t('allDecks')} onSelect={() => router.push('/')} />
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('groups.deck')}</DropdownMenuLabel>
        <MenuItem
          icon={FileAddIcon}
          label={t('newDeck')}
          onSelect={() => router.push(NEW_DECK_HREF)}
        />
        <MenuItem icon={FileUploadIcon} label={t('replaceTemplate')} />
        <MenuItem icon={FileUploadIcon} label={t('replaceContent')} />
        <DropdownMenuSeparator />
        <MenuItem
          icon={PencilEdit01Icon}
          label={t('rename')}
          onSelect={() => {
            renameAsked.current = true;
          }}
        />
        <MenuItem icon={Copy01Icon} label={t('duplicate')} />
        <MenuItem icon={Clock01Icon} label={t('history')} />
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('groups.download')}</DropdownMenuLabel>
        <MenuItem icon={Ppt01Icon} label={t('exportPptx')} onSelect={exportAs('pptx')} />
        <MenuItem icon={Pdf01Icon} label={t('exportPdf')} onSelect={exportAs('pdf')} />
        <MenuItem icon={Image01Icon} label={t('exportPng')} onSelect={exportAs('png')} />
        <MenuItem icon={Globe02Icon} label={t('exportHtml')} onSelect={exportAs('html')} />
        <MenuItem icon={CodeIcon} label={t('manifest')} />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            settingsAsked.current = true;
          }}
        >
          <HugeiconsIcon icon={Settings01Icon} strokeWidth={1.5} />
          {t('settings')}
          <DropdownMenuShortcut>{shortcutText('settings', mac)}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-xs text-balance text-muted-foreground">{t('pendingApi')}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Пункт меню. Без обработчика — неактивен: действию пока не на что опереться. */
function MenuItem({
  icon,
  label,
  onSelect,
}: {
  icon: IconSvgElement;
  label: string;
  onSelect?: () => void;
}) {
  return (
    <DropdownMenuItem disabled={!onSelect} onSelect={onSelect}>
      <HugeiconsIcon icon={icon} strokeWidth={1.5} />
      {label}
    </DropdownMenuItem>
  );
}

/**
 * Кнопка полосы. Без `onClick` она остаётся в фокусе и с подсказкой, но ничего не делает:
 * у `disabled` подсказка не показывается, а объяснение здесь важнее.
 */
function BarButton({
  icon,
  label,
  pending,
  onClick,
  primary,
}: {
  icon: IconSvgElement;
  label: string;
  pending: string;
  onClick?: () => void;
  primary?: boolean;
}) {
  const available = onClick !== undefined;
  const button = (
    <Button
      variant={primary ? 'default' : 'ghost'}
      aria-disabled={!available || undefined}
      aria-label={available ? undefined : `${label}. ${pending}`}
      onMouseDown={keepCanvasFocus}
      onClick={onClick}
      className={cn(
        'gap-1.5',
        !available && 'cursor-default opacity-50 hover:bg-transparent',
        !available && primary && 'hover:bg-primary',
      )}
    >
      <HugeiconsIcon icon={icon} strokeWidth={1.5} />
      <span className={cn('tabular-nums', !primary && 'max-lg:sr-only')}>{label}</span>
    </Button>
  );
  if (available) return button;
  return <WithTooltip label={pending}>{button}</WithTooltip>;
}

function WithTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Правка названия на месте: Enter или уход из поля — сохранить, Esc — отменить. */
function RenameInput({ title, onDone }: { title: string; onDone: (title: string | null) => void }) {
  const t = useTranslations('fileBar');
  const [draft, setDraft] = useState(title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  // Enter и Esc закрывают поле, а за ними может прийти ещё и blur: второй раз не решаем.
  const settled = useRef(false);
  const settle = (next: string | null) => {
    if (settled.current) return;
    settled.current = true;
    onDone(next);
  };
  const finish = (next: string) => {
    const trimmed = next.trim();
    settle(trimmed === '' || trimmed === title ? null : trimmed);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(draft);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      settle(null);
    }
  };
  return (
    <input
      ref={input}
      aria-label={t('renameLabel')}
      value={draft}
      maxLength={200}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => finish(draft)}
      onKeyDown={onKeyDown}
      className={cn(
        'h-7 w-full max-w-96 rounded-md bg-background px-2 text-xs font-medium text-foreground',
        'ring-1 ring-ring outline-none',
      )}
    />
  );
}
