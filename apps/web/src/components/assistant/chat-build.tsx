'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { jobEventSchema, type ChatPart } from '@lct/contracts';
import { apiFetch } from '@/lib/api';
import { generationProgress } from '@/lib/deck-generator';
import { TaskGlyph } from './task-glyph';
import { SpinnerIcon, SuccessIcon, WarningIcon } from '@/components/ui/icons';
import type { DeckResult } from '@/lib/variant-review';
import { loadResultVariants } from '@/lib/load-result-variants';
import { Button } from '@/components/ui/button';
import { BuildCard, BuildCardView, type BuildRun } from './build-card';
import { formatElapsed } from './elapsed';
import { ResultCard } from './result-card';
import { chatStore, followBuild, useRun } from './session';
import { loadVariantPreview } from './use-variant-deck';

type BuildPart = Extract<ChatPart, { type: 'build' }>;
type ResultPart = Extract<ChatPart, { type: 'result' }>;

/**
 * Сборка, которую запустил агент. Пока она идёт, вкладка досматривает её прогон, и карточка
 * показывает ход по этапам, как у сборки из поля. Прогона во вкладке нет (страницу открыли после
 * сборки) — этапы восстанавливаются из сохранённых событий прогона.
 */
export function ChatBuild({ part, latest }: { part: BuildPart; latest: boolean }) {
  const t = useTranslations('deckChat.build');
  const tw = useTranslations('assistant.work');
  const run = useRun(part.runId);
  const { runId, status } = part;
  const [history, setHistory] = useState<BuildRun | null>(null);
  const { startedAt, finishedAt } = part;
  // A finished build has no live subscription after reload. Read its saved stages once.
  useEffect(() => {
    if (!runId || run || status === 'running' || status === 'preparing') return;
    const controller = new AbortController();
    void apiFetch(`/runs/${encodeURIComponent(runId)}/events?after=-1`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const events = jobEventSchema.array().parse(await response.json());
        if (controller.signal.aborted || events.length === 0) return;
        const stages = [
          ...new Set(events.flatMap((event) => ('stage' in event ? [event.stage] : []))),
        ];
        const progress = generationProgress(stages, events);
        setHistory({
          runId,
          phase: status,
          progress,
          slides: [],
          startedAt,
          finishedAt,
          failure: progress.failure,
        });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [runId, run, status, startedAt, finishedAt]);

  useEffect(() => {
    if (runId === null || status !== 'running') return;
    followBuild({ ...part, runId });
  }, [part, runId, status]);

  if (status === 'preparing') {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 text-[0.8125rem] text-muted-foreground"
      >
        <TaskGlyph state="running" className="text-foreground" />
        <span className="assistant-shimmer">{t('preparing', { template: part.templateName })}</span>
      </div>
    );
  }
  if (runId !== null && run) {
    return (
      <BuildCard runId={runId} latest={latest} unfinished={status === 'running'} retry={false} />
    );
  }
  if (history?.runId === runId)
    return <BuildCardView run={history} latest={latest} retry={false} />;
  const elapsed = part.finishedAt === null ? null : part.finishedAt - part.startedAt;
  const line =
    status === 'done'
      ? t('done', { time: formatElapsed(elapsed ?? 0) })
      : status === 'cancelled'
        ? t('cancelled')
        : status === 'failed'
          ? part.error
            ? /HTTP 429\b/.test(part.error)
              ? tw('rateLimited')
              : t('failedWith', { reason: part.error })
            : t('failed')
          : null;
  if (!line) return null;
  const Icon = status === 'done' ? SuccessIcon : WarningIcon;
  return (
    <p className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
      <Icon className="size-4 shrink-0" aria-hidden />
      {line}
    </p>
  );
}

type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly result: DeckResult; readonly failedCount: number };

/**
 * Итог сборки агента: превью подгружаются из библиотеки, аудит и совет берутся из итога сборки.
 */
export function ChatResult({
  chatId,
  part,
  compact = false,
  currentDeckId,
}: {
  chatId: string;
  part: ResultPart;
  compact?: boolean;
  currentDeckId?: string;
}) {
  const t = useTranslations('assistant.result');
  const [loaded, setLoaded] = useState<{ key: string; value: Loaded }>({
    key: '',
    value: { status: 'loading' },
  });
  const [attempt, setAttempt] = useState(0);
  // SSE may replace `part` with an identical object. Its identity must not restart loading.
  const key = JSON.stringify(part);
  const loadKey = `${key}:${attempt}`;

  useEffect(() => {
    let live = true;
    const snapshot = JSON.parse(key) as ResultPart;
    loadResultVariants(snapshot, loadVariantPreview).then(
      ({ result, failedCount }) => {
        if (!live) return;
        setLoaded({
          key: `${key}:${attempt}`,
          value: {
            status: 'ready',
            result,
            failedCount,
          },
        });
      },
      () => live && setLoaded({ key: `${key}:${attempt}`, value: { status: 'failed' } }),
    );
    return () => {
      live = false;
    };
  }, [key, attempt]);

  const value = loaded.key === loadKey ? loaded.value : { status: 'loading' as const };
  if (value.status === 'loading') {
    return (
      <p role="status" className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
        <SpinnerIcon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        {t('title')}
      </p>
    );
  }
  if (value.status === 'failed' || value.result.variants.length === 0) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2">
        <p className="text-[0.8125rem] text-destructive">{t('loadFailed')}</p>
        <Button variant="outline" onClick={() => setAttempt((current) => current + 1)}>
          {t('retryLoad')}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {value.failedCount > 0 ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
        >
          <p>{t('partialLoad', { count: value.failedCount })}</p>
          <Button variant="outline" onClick={() => setAttempt((current) => current + 1)}>
            {t('retryLoad')}
          </Button>
        </div>
      ) : null}
      <ResultCard
        result={value.result}
        compact={compact}
        currentDeckId={currentDeckId}
        onChoose={(deckId) => chatStore.choose(chatId, deckId)}
      />
    </div>
  );
}
