'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { CloseIcon, FileIcon, SlideIcon, TemplateIcon } from '@/components/ui/icons';
import { useAssistantDeck, type AssistantDeckBridge } from '@/components/assistant/deck-context';
import { refIcon, useSlideRefLabels } from '@/components/assistant/slide-ref-label';
import { useFileSize } from '@/components/library/file-size';
import { Button } from '@/components/ui/button';
import { contentFileKind } from '@/lib/deck-generator';
import { resolveRef, type SlideRef } from '@/lib/slide-context';
import { cn } from '@/lib/utils';

/** Файл, приложенный к сообщению: материал или шаблон. Размер шаблона из библиотеки неизвестен. */
export interface FileAttachment {
  readonly kind: 'file' | 'template' | 'context';
  readonly name: string;
  readonly size?: number;
  /** Миниатюра выбранного шаблона библиотеки. У нового файла её ещё нет. */
  readonly previewUrl?: string;
}

/**
 * Вложение чипом: иконка вида, имя, чем файл станет и размер. Один и тот же чип стоит в поле
 * генерации (с крестиком) и в сообщении человека в разговоре — чтобы было видно, что ушло
 * агенту ровно то, что лежало в поле. Шаблон отличается иконкой и подписью: он не материал
 * контент-пака, а стиль всей презентации.
 *
 * Объекты слайда (`slide-ref`) — тот же чип, но связанный с холстом: наведение подсвечивает
 * объекты, нажатие открывает слайд и выделяет их. Удалённое зачёркнуто и в отправку не идёт.
 */
export function AttachmentChip({
  attachment,
  onRemove,
  ghost = false,
  onPin,
  className,
}: {
  /** Вложение сообщения или ссылка на объекты слайда в поле ассистента. */
  attachment: FileAttachment | SlideRef;
  /** Убрать вложение; нет — чип только показывает. */
  onRemove?: () => void;
  /**
   * Призрак: текущее выделение, которое уйдёт с сообщением, если его не убрать. Пунктирный
   * и приглушённый; нажатие закрепляет (`onPin`).
   */
  ghost?: boolean;
  onPin?: () => void;
  className?: string;
}) {
  if (attachment.kind === 'slide-ref') {
    return (
      <SlideRefChip
        reference={attachment}
        ghost={ghost}
        onPin={onPin}
        onRemove={onRemove}
        className={className}
      />
    );
  }
  return <FileChip attachment={attachment} onRemove={onRemove} className={className} />;
}

function FileChip({
  attachment,
  onRemove,
  className,
}: {
  attachment: FileAttachment;
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
      {kind === 'template' && attachment.previewUrl ? (
        <img
          src={attachment.previewUrl}
          alt=""
          aria-hidden
          className="h-6 w-9 shrink-0 rounded-sm object-cover ring-1 ring-border"
        />
      ) : kind === 'template' ? (
        <TemplateIcon size={14} className="shrink-0 text-foreground" aria-hidden />
      ) : kind === 'context' ? (
        <SlideIcon size={14} className="shrink-0 text-muted-foreground" aria-hidden />
      ) : (
        <FileIcon size={14} className="shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span className="max-w-48 truncate text-foreground">{name}</span>
      <span className="shrink-0 text-muted-foreground tabular-nums">
        {[label, size ? fileSize(size) : null].filter(Boolean).join(' · ')}
      </span>
      {onRemove ? <RemoveButton label={t('removeFile', { name })} onRemove={onRemove} /> : null}
    </li>
  );
}

function RemoveButton({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="shrink-0 rounded-md"
      aria-label={label}
      onClick={onRemove}
    >
      <CloseIcon />
    </Button>
  );
}

/**
 * Чип объектов слайда. В поле подпись живая — номер слайда следует за перестановкой, — а в
 * отправленном сообщении такая, какой ушла агенту. Устаревшим чип считается по колоде в
 * редакторе; вне редактора моста нет, и чип только показывает.
 */
function SlideRefChip({
  reference,
  ghost,
  onPin,
  onRemove,
  className,
}: {
  reference: SlideRef;
  ghost: boolean;
  onPin?: () => void;
  onRemove?: () => void;
  className?: string;
}) {
  const t = useTranslations('assistant.context');
  const { label } = useSlideRefLabels();
  const bridge = useAssistantDeck();
  const resolved = bridge ? resolveRef(bridge.slides, reference) : null;
  const live = resolved?.status === 'live' ? resolved : null;
  const stale = resolved?.status === 'stale' ? resolved : null;
  // Отправленное подписано так, как его увидел агент; лежащее в поле — как сейчас в колоде.
  const sent = 'context' in reference;
  const subject = !sent && live ? live.subject : reference.subject;
  const text = label(subject, !sent && live ? live.slideNumber : reference.slideNumber);

  // Мост меняется с каждой правкой колоды — снять подсветку при уходе чипа надо последним.
  const bridgeRef = useRef<AssistantDeckBridge | null>(bridge);
  const hovering = useRef(false);
  useEffect(() => {
    bridgeRef.current = bridge;
  });
  useEffect(
    () => () => {
      if (hovering.current) bridgeRef.current?.highlight(null);
    },
    [],
  );
  const enter = () => {
    if (!bridge || stale) return;
    hovering.current = true;
    bridge.highlight(reference);
  };
  const leave = () => {
    if (!hovering.current) return;
    hovering.current = false;
    bridge?.highlight(null);
  };

  const accessible = stale
    ? t(stale.reason === 'slide-removed' ? 'staleSlide' : 'staleElements', { label: text })
    : ghost
      ? t('ghostAction', { label: text })
      : t('show', { label: text });
  const clickable = bridge !== null && stale === null && (!ghost || onPin !== undefined);
  const RefIcon = refIcon(subject);
  const body = (
    <>
      <RefIcon
        size={14}
        className={cn('shrink-0', ghost || stale ? 'text-muted-foreground' : 'text-foreground')}
        aria-hidden
      />
      <span
        className={cn(
          'max-w-56 truncate',
          ghost || stale ? 'text-muted-foreground' : 'text-foreground',
          stale && 'line-through decoration-muted-foreground/70',
        )}
      >
        {ghost ? t('ghost', { label: text }) : text}
      </span>
      {stale ? <span className="shrink-0 text-muted-foreground">{t('stale')}</span> : null}
    </>
  );
  const bodyClass = cn(
    'flex min-w-0 items-center gap-1.5 rounded-[inherit] py-1 pl-2 outline-none',
    onRemove ? 'pr-1' : 'pr-2',
  );

  return (
    <li
      data-slide-ref=""
      data-ghost={ghost ? '' : undefined}
      data-stale={stale ? '' : undefined}
      onMouseEnter={enter}
      onMouseLeave={leave}
      className={cn(
        'flex max-w-full min-w-0 items-center rounded-lg text-xs',
        'transition-colors duration-100 motion-reduce:transition-none',
        ghost
          ? 'border border-dashed border-muted-foreground/40 bg-transparent'
          : 'bg-muted/60 ring-1 ring-border',
        clickable && (ghost ? 'hover:border-muted-foreground/70' : 'hover:bg-muted'),
        onRemove && 'pr-0.5',
        'animate-in fade-in-0 duration-150 motion-reduce:animate-none',
        className,
      )}
    >
      {clickable ? (
        <button
          type="button"
          aria-label={accessible}
          title={ghost ? t('ghostHint') : undefined}
          onClick={() => {
            if (ghost) onPin?.();
            else bridge?.reveal(reference);
          }}
          onFocus={enter}
          onBlur={leave}
          className={cn(bodyClass, 'focus-visible:ring-2 focus-visible:ring-ring/50')}
        >
          {body}
        </button>
      ) : (
        // Показывает, но не действует: вне редактора или устарел. Подпись читается как есть,
        // причина — в подсказке.
        <span title={stale ? accessible : undefined} className={bodyClass}>
          {body}
        </span>
      )}
      {onRemove ? <RemoveButton label={t('remove', { label: text })} onRemove={onRemove} /> : null}
    </li>
  );
}
