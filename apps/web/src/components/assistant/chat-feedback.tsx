'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { RetryIcon, SpinnerIcon, WarningIcon } from '@/components/ui/icons';
import type { ChatView } from '@/lib/chat-store';
import { chatStore } from './session';

/** Transport errors have their own actions, independently of the assistant's answer. */
export function ChatFeedback({ chat }: { chat: ChatView }) {
  const t = useTranslations('deckChat.connection');
  const hasDraft = Boolean(
    chat.draft.text || chat.draft.files.length || chat.draft.templateFile || chat.draft.template,
  );
  if (chat.selectionError && !chat.error)
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{t('selectionFailed')}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => chatStore.setModel(chat.chatId, chat.model)}
        >
          {t('retry')}
        </Button>
      </div>
    );
  if (chat.error)
    return (
      <div
        role="alert"
        className="flex flex-col gap-2 rounded-xl bg-destructive/5 p-3 ring-1 ring-destructive/15"
      >
        <div className="flex items-start gap-2 text-sm">
          <WarningIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium">
              {t(
                chat.recovery === 'cancel'
                  ? 'cancelFailed'
                  : chat.recovery === 'reconnect'
                    ? 'interrupted'
                    : 'failed',
              )}
            </p>
            <p className="mt-1 text-xs break-words text-muted-foreground">{chat.error}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => chatStore.retry(chat.chatId)}
          >
            <RetryIcon />
            {t(
              chat.recovery === 'reconnect'
                ? 'reconnect'
                : chat.recovery === 'cancel'
                  ? 'retryCancel'
                  : 'retry',
            )}
          </Button>
          {chat.pending?.restorable && !hasDraft ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => chatStore.restore(chat.chatId)}
            >
              {t('restore')}
            </Button>
          ) : null}
        </div>
      </div>
    );
  if (chat.activity === 'idle' || chat.activity === 'answering') return null;
  return (
    <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
      <SpinnerIcon className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
      {t(chat.activity)}
    </p>
  );
}
