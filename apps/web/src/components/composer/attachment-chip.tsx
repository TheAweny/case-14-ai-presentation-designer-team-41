'use client';

import { useTranslations } from 'next-intl';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, File01Icon, LayoutTemplateIcon } from '@hugeicons/core-free-icons';
import { useFileSize } from '@/components/library/file-size';
import { Button } from '@/components/ui/button';
import type { MessageAttachment } from '@/lib/assistant-threads';
import { contentFileKind } from '@/lib/deck-generator';
import { cn } from '@/lib/utils';

/**
 * Вложение чипом: иконка вида, имя, чем файл станет и размер. Один и тот же чип стоит в поле
 * генерации (с крестиком) и в сообщении человека в разговоре — чтобы было видно, что ушло
 * агенту ровно то, что лежало в поле. Шаблон отличается иконкой и подписью: он не материал
 * контент-пака, а стиль всей презентации.
 */
export function AttachmentChip({
  attachment,
  onRemove,
  className,
}: {
  attachment: MessageAttachment;
  /** Убрать вложение; нет — чип только показывает. */
  onRemove?: () => void;
  className?: string;
}) {
  const t = useTranslations('composer');
  const fileSize = useFileSize();
  const { kind, name, size } = attachment;
  const contentKind = kind === 'file' ? contentFileKind(name) : null;
  const label =
    kind === 'template' ? t('kinds.template') : contentKind ? t(`kinds.${contentKind}`) : null;
  return (
    <li
      className={cn(
        'flex max-w-full min-w-0 items-center gap-1.5 rounded-lg bg-muted/60 py-1 text-xs ring-1 ring-border',
        onRemove ? 'pr-0.5 pl-2' : 'px-2',
        className,
      )}
    >
      <HugeiconsIcon
        icon={kind === 'template' ? LayoutTemplateIcon : File01Icon}
        size={14}
        strokeWidth={1.5}
        className={cn(
          'shrink-0',
          kind === 'template' ? 'text-foreground' : 'text-muted-foreground',
        )}
        aria-hidden
      />
      <span className="max-w-48 truncate text-foreground">{name}</span>
      <span className="shrink-0 text-muted-foreground tabular-nums">
        {label ? `${label} · ` : ''}
        {fileSize(size)}
      </span>
      {onRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="rounded-md"
          aria-label={t('removeFile', { name })}
          onClick={onRemove}
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
        </Button>
      ) : null}
    </li>
  );
}
