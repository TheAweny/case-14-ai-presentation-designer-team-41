'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ChatPart, ModelRef } from '@lct/contracts';
import { ModelMenu } from '@/components/composer/model-menu';
import {
  useWriterModels,
  useModelSettingsSnapshot,
} from '@/components/settings/model-settings-store';
import { openSettings } from '@/components/settings/open-settings';
import { Button } from '@/components/ui/button';
import { RetryIcon, WarningIcon } from '@/components/ui/icons';
import { effectiveModel, sameModel, shortModelName } from '@/lib/writer-models';
import { chatStore, useChat } from './session';

/** Recovery stays with the failed answer; choosing a replacement never changes global defaults. */
export function ModelErrorCard({
  part,
  chatId,
  messageId,
  retryable,
  active,
  onRefine,
}: {
  part: Extract<ChatPart, { type: 'error' }>;
  chatId: string;
  messageId: string;
  retryable: boolean;
  active: boolean;
  onRefine: () => void;
}) {
  const t = useTranslations('deckChat.failure');
  const chat = useChat(chatId);
  const models = useWriterModels('assistant');
  const settings = useModelSettingsSnapshot();
  const connection = settings?.connections.find(
    (item) => item.connectionId === part.failure?.connectionId,
  );
  const editableConnection =
    connection && !connection.managed && connection.editable !== false
      ? connection.connectionId
      : undefined;
  const [selection, setSelection] = useState<{ model: ModelRef | null } | null>(null);
  const [remaining, setRemaining] = useState(0);
  const retryAt = part.failure?.retryAt;
  useEffect(() => {
    const tick = () =>
      setRemaining(retryAt ? Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)) : 0);
    tick();
    if (!retryAt) return;
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  const kind = part.failure?.kind ?? 'unknown';
  const value = selection ? selection.model : (chat?.model ?? null);
  const resolved = models ? effectiveModel(models, value) : value;
  const original = part.failure?.modelId;
  const replacement =
    selection !== null &&
    (original
      ? resolved?.modelId !== original ||
        (part.failure?.connectionId !== undefined &&
          resolved?.connectionId !== part.failure.connectionId)
      : !sameModel(
          resolved,
          models ? effectiveModel(models, chat?.model ?? null) : (chat?.model ?? null),
        ));
  const wait = kind === 'rate-limit' && remaining > 0 && !replacement;
  const canRepeat =
    retryable &&
    (replacement || !['unauthorized', 'not-configured', 'context', 'unsupported'].includes(kind));
  const draftEmpty =
    !chat?.draft.text &&
    !chat?.draft.files.length &&
    !chat?.draft.templateFile &&
    !chat?.draft.template &&
    !chat?.draft.attachments?.length &&
    !chat?.draft.context?.length;
  return (
    <div
      role="alert"
      className="grid gap-3 rounded-xl bg-destructive/5 p-3 ring-1 ring-destructive/15"
    >
      <div className="flex items-start gap-2">
        <WarningIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t(`reasons.${kind}`)}</p>
          {original ? (
            <p className="mt-1 break-all text-xs text-muted-foreground">{original}</p>
          ) : null}
          <details className="mt-1 text-xs text-muted-foreground">
            <summary className="cursor-pointer">{t('details')}</summary>
            <p className="mt-1 break-words">{part.message}</p>
          </details>
        </div>
      </div>
      {active ? (
        <div className="flex flex-wrap items-center gap-2">
          {canRepeat ? (
            <Button
              size="sm"
              variant="outline"
              disabled={wait}
              onClick={() =>
                chatStore.retryAnswer(chatId, messageId, selection ? selection.model : undefined)
              }
            >
              <RetryIcon />
              {wait
                ? t('retryAfter', { seconds: remaining })
                : replacement && resolved
                  ? t('retryWith', { model: shortModelName(resolved.modelId) })
                  : t('retry')}
            </Button>
          ) : null}
          <ModelMenu
            compact
            label={t('changeModel')}
            value={value}
            onChange={(model) => {
              setSelection({ model });
              if (!retryable) chatStore.setModel(chatId, model);
            }}
          />
          {['unauthorized', 'not-configured'].includes(kind) ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => openSettings('models', editableConnection)}
            >
              {editableConnection ? t('connection') : t('settings')}
            </Button>
          ) : null}
          {retryable && draftEmpty ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                chatStore.editFailed(chatId, messageId);
                onRefine();
              }}
            >
              {t('edit')}
            </Button>
          ) : null}
          {!retryable ? (
            <>
              <p className="w-full text-xs text-muted-foreground">{t('partial')}</p>
              <Button
                size="sm"
                variant="outline"
                disabled={Boolean(chat?.running || chat?.pending || chat?.recovery)}
                onClick={() => {
                  chatStore.continueAfterFailure(
                    chatId,
                    messageId,
                    t('continueMessage'),
                    selection ? selection.model : undefined,
                  );
                  onRefine();
                }}
              >
                {t('continue')}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
