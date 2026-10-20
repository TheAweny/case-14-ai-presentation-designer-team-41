'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ChatPart, ModelRef } from '@lct/contracts';
import { ModelMenu } from '@/components/composer/model-menu';
import {
  useWriterModels,
  useModelSettingsSnapshot,
} from '@/components/settings/model-settings-store';
import { openSettings } from '@/components/settings/open-settings';
import { Button } from '@/components/ui/button';
import { ChevronDownIcon, RetryIcon, WarningIcon } from '@/components/ui/icons';
import { AnimatedCollapse } from '@/components/ui/animated-collapse';
import { cn } from '@/lib/utils';
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
  const kind = part.failure?.kind ?? 'unknown';
  const preparation = part.failure?.stage === 'template-index';
  const planningRole = preparation && part.failure?.role === 'planner';
  const quota = kind === 'quota-exhausted';
  useEffect(() => {
    if (kind !== 'rate-limit') {
      setRemaining(0);
      return;
    }
    const tick = () =>
      setRemaining(retryAt ? Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)) : 0);
    tick();
    if (!retryAt) return;
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [kind, retryAt]);
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
  const otherConnection =
    selection !== null &&
    part.failure?.connectionId !== undefined &&
    resolved?.connectionId !== undefined &&
    resolved.connectionId !== part.failure.connectionId;
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
  const detailsId = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  return (
    <div
      role="alert"
      className="grid min-w-0 gap-3 rounded-xl border border-border bg-card p-3 text-card-foreground"
    >
      <div className="flex min-w-0 items-start gap-2">
        <WarningIcon className="mt-0.5 size-4 shrink-0 text-destructive/80" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {preparation ? t('preparation.title') : t(`reasons.${kind}`)}
          </p>
          {preparation ? (
            <>
              <p className="mt-1 text-sm">{t(`reasons.${kind}`)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t(planningRole ? 'preparation.helper' : 'preparation.chatHelper')}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{t('preparation.saved')}</p>
            </>
          ) : null}
          {quota ? (
            <p className="mt-1 text-xs text-muted-foreground">{t('helper.quota-exhausted')}</p>
          ) : null}
          {original ? (
            <p className="mt-1 break-all text-xs text-muted-foreground">{original}</p>
          ) : null}
          <button
            type="button"
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            onClick={() => setDetailsOpen((open) => !open)}
            className="mt-1 inline-flex min-h-6 items-center gap-1 rounded-md text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('details')}
            <ChevronDownIcon
              aria-hidden
              className={cn(
                'size-3 shrink-0 transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
                !detailsOpen && '-rotate-90',
              )}
            />
          </button>
          <AnimatedCollapse open={detailsOpen} id={detailsId}>
            <p className="mt-1 max-w-full cursor-text select-text break-words text-xs text-muted-foreground">
              {part.message}
              {part.failure?.httpStatus ? ` (HTTP ${part.failure.httpStatus})` : ''}
            </p>
          </AnimatedCollapse>
        </div>
      </div>
      {active ? (
        <div className="flex flex-wrap items-center gap-2">
          {canRepeat && !preparation ? (
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
                : quota && !otherConnection
                  ? t('retryQuota')
                  : replacement && resolved
                    ? t('retryWith', { model: shortModelName(resolved.modelId) })
                    : t('retry')}
            </Button>
          ) : null}
          {!planningRole ? (
            <ModelMenu
              compact
              label={t('changeModel')}
              value={value}
              onChange={(model) => {
                setSelection({ model });
                if (!retryable) chatStore.setModel(chatId, model);
              }}
            />
          ) : null}
          {preparation ||
          ['unauthorized', 'not-configured', 'unsupported'].includes(kind) ||
          quota ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => openSettings('models', editableConnection)}
            >
              {planningRole
                ? t('preparation.settings')
                : editableConnection
                  ? t('connection')
                  : t('settings')}
            </Button>
          ) : null}
          {retryable && draftEmpty && !preparation ? (
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
          {preparation ? (
            <Button
              size="sm"
              variant="outline"
              disabled={Boolean(chat?.running || chat?.pending || chat?.recovery) || wait}
              onClick={() => {
                chatStore.continueAfterFailure(
                  chatId,
                  messageId,
                  t('preparation.continueMessage'),
                  selection ? selection.model : undefined,
                );
                onRefine();
              }}
            >
              <RetryIcon />
              {wait ? t('retryAfter', { seconds: remaining }) : t('preparation.retry')}
            </Button>
          ) : null}
          {!retryable && !preparation ? (
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
                {quota && !otherConnection ? t('continueQuota') : t('continue')}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
