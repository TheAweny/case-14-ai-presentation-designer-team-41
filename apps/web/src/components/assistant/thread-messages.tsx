'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckIcon, CopyIcon, EditIcon } from '@/components/ui/icons';
import { AttachmentChip, type FileAttachment } from '@/components/composer/attachment-chip';
import { cn } from '@/lib/utils';
import type { RunStatus } from './run-status';

/**
 * Плотность разговора. Панель редактора узкая, и текст в ней мельче; страница разговора — место
 * для чтения, текст там крупнее. Карточки от плотности не зависят.
 */
export type ThreadDensity = 'compact' | 'comfortable';

export const ThreadDensityContext = createContext<ThreadDensity>('compact');

/** Размер текста реплик при данной плотности. */
export function useMessageText(): string {
  return useContext(ThreadDensityContext) === 'comfortable'
    ? 'text-[0.9375rem]/relaxed'
    : 'text-[0.8125rem]/relaxed';
}

/**
 * Реплика человека: вложения чипами, как они лежали в поле, текст пузырём справа. При наведении —
 * «Копировать» и «Изменить»: второе возвращает текст в поле, чтобы поправить и отправить заново.
 * `note` — тихая строка под пузырём: сообщение ещё едет или не ушло.
 */
export function UserMessage({
  text: message,
  attachments,
  note,
  onEdit,
}: {
  text: string;
  attachments: readonly FileAttachment[];
  note?: { readonly text: string; readonly failed: boolean } | null;
  /** Вернуть текст в поле; без обработчика «Изменить» нет. */
  onEdit?: (text: string) => void;
}) {
  const t = useTranslations('assistant.user');
  const text = useMessageText();
  return (
    <div className="group/message flex max-w-[88%] flex-col items-end gap-1.5 self-end">
      {attachments.length > 0 ? (
        <ul className="flex flex-wrap justify-end gap-1.5" aria-label={t('attachments')}>
          {attachments.map((attachment, index) => (
            <AttachmentChip key={`${attachment.kind}-${index}`} attachment={attachment} />
          ))}
        </ul>
      ) : null}
      {message ? (
        <p
          className={cn(
            'rounded-2xl rounded-br-md bg-muted px-3.5 py-2 whitespace-pre-wrap text-foreground',
            text,
          )}
        >
          {message}
        </p>
      ) : null}
      {note ? (
        <p
          role="status"
          className={cn(
            'px-1 text-right text-[0.6875rem]',
            note.failed ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {note.text}
        </p>
      ) : message ? (
        <MessageActions text={message} onEdit={onEdit ? () => onEdit(message) : undefined} />
      ) : null}
    </div>
  );
}

/**
 * Действия у реплики: видны при наведении и фокусе с клавиатуры, а на сенсорных экранах, где
 * наведения нет, — всегда.
 */
function MessageActions({ text, onEdit }: { text: string; onEdit?: () => void }) {
  const t = useTranslations('assistant.actions');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    navigator.clipboard.writeText(text).then(
      () => setCopied(true),
      () => undefined,
    );
  };

  const button =
    'grid size-7 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50';
  return (
    <div
      className={cn(
        '-mt-1 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 motion-reduce:transition-none',
        'group-hover/message:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100',
      )}
    >
      <button
        type="button"
        onClick={copy}
        aria-label={t('copy')}
        title={t('copy')}
        className={button}
      >
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </button>
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={t('edit')}
          title={t('edit')}
          className={button}
        >
          <EditIcon className="size-3.5" />
        </button>
      ) : null}
      <span role="status" className="sr-only">
        {copied ? t('copied') : ''}
      </span>
    </div>
  );
}

/**
 * Агент принял реплику и ещё не ответил. У демо ответ приходит сразу, у настоящего агента пауза
 * заметна — без знака кажется, что сообщение потерялось.
 */
export function ThinkingLine() {
  const t = useTranslations('assistant.actions');
  return (
    <p role="status" className="assistant-shimmer text-[0.8125rem] motion-reduce:animate-none">
      {t('thinking')}
    </p>
  );
}

/** Заголовок хода сборки словами интерфейса — для обеих карточек хода. */
export function useRunStatusText(): (status: RunStatus) => string {
  const t = useTranslations('assistant.work');
  return (status) => {
    switch (status.key) {
      case 'layingOut':
        return t('layingOut', { done: status.done, total: status.total });
      case 'stage':
        return t('stage', { stage: t(`stages.${status.stage}`) });
      default:
        return t(status.key);
    }
  };
}
