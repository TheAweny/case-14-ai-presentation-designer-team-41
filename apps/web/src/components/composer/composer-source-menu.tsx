'use client';

import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { FileIcon, PlusIcon, SlideIcon, TemplateIcon } from '@/components/ui/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { TemplateGroups } from '@/lib/composer-templates';
import { TemplateMenuSection } from './composer-template-menu';

/**
 * Единственный вход вложений: файл, шаблон из библиотеки, загрузка шаблона и, в редакторе,
 * объекты слайда. Отдельной скрепки и отдельной кнопки шаблона нет.
 */
export function ComposerSourceMenu({
  onFiles,
  onContext,
  onBrandbook,
  groups,
  inProject,
  selectedId,
  pendingFile,
  onSelectTemplate,
  onUploadTemplate,
  compact = false,
  disabled = false,
}: {
  onFiles: () => void;
  /** Загрузить отдельный брендбук, который не трактуется как материал. */
  onBrandbook?: () => void;
  /** В редакторе: вставить `@` и открыть список слайдов и объектов. */
  onContext?: () => void;
  groups: TemplateGroups;
  inProject: boolean;
  selectedId: string | null;
  pendingFile: boolean;
  onSelectTemplate: (templateId: string) => void;
  onUploadTemplate: () => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations('deckChat.input');
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={compact ? 'icon' : 'icon-lg'}
          disabled={disabled}
          aria-label={t('add')}
          className="rounded-full bg-muted/40 text-muted-foreground transition-[background-color,color,transform] duration-200 data-[state=open]:bg-muted data-[state=open]:text-foreground active:scale-95 motion-reduce:transform-none"
        >
          <motion.span
            className="inline-flex"
            initial={false}
            animate={{ rotate: reduce ? 0 : open ? 45 : 0 }}
            transition={{ type: 'spring', stiffness: 440, damping: 28 }}
          >
            <PlusIcon className="size-4" />
          </motion.span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        aria-label={t('add')}
        glow
        className="w-80 max-w-[calc(100vw-2rem)]"
      >
        {onBrandbook ? (
          <DropdownMenuItem onSelect={onBrandbook} className="gap-2.5 rounded-lg px-2.5 py-2">
            <TemplateIcon className="size-4 shrink-0" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span>{t('brandbook')}</span>
              <span className="truncate text-xs text-muted-foreground">{t('brandbookHint')}</span>
            </span>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={onFiles} className="gap-2.5 rounded-lg px-2.5 py-2">
          <FileIcon className="size-4 shrink-0" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span>{t('materials')}</span>
            <span className="truncate text-xs text-muted-foreground">{t('materialsHint')}</span>
          </span>
        </DropdownMenuItem>
        {onContext ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onContext} className="rounded-lg px-2.5 py-2">
              <SlideIcon />
              {t('context')}
            </DropdownMenuItem>
          </>
        ) : null}
        <TemplateMenuSection
          groups={groups}
          inProject={inProject}
          selectedId={selectedId}
          pendingFile={pendingFile}
          onSelect={onSelectTemplate}
          onUpload={onUploadTemplate}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
