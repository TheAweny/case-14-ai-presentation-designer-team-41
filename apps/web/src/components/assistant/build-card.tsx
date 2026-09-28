'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  CheckIcon,
  ChevronDownIcon,
  RetryIcon,
  SpinnerIcon,
  WarningIcon,
} from '@/components/ui/icons';
import { SlideView } from '@lct/slide-renderer';
import { Button } from '@/components/ui/button';
import { GENERATION_BUDGET_MS, type GenerationStage } from '@/lib/deck-generator';
import type { GenerationRun } from '@/lib/generation-runs';
import { cn } from '@/lib/utils';
import { formatElapsed, useNow } from './elapsed';
import { generationRuns, useRun } from './session';
import { SlidesDialog } from './slides-dialog';

/**
 * Ход сборки на странице разговора: что происходит, сколько прошло из бюджета, этапы пайплайна
 * и слайды, которые появляются по мере вёрстки. Пока сборка идёт, карточка раскрыта; готова —
 * сворачивается в строку, а слайды остаются по нажатию: итог ниже показывает все три варианта.
 *
 * Сборку, которую сменила новая, повторять незачем: она подписана и без кнопки повтора.
 */
export function BuildCard({ runId, latest }: { runId: string; latest: boolean }) {
  const run = useRun(runId);
  if (!run) return null;
  return <BuildCardView run={run} latest={latest} />;
}

function BuildCardView({ run, latest }: { run: GenerationRun; latest: boolean }) {
  const t = useTranslations('assistant.work');
  const tb = useTranslations('assistant.build');
  const tv = useTranslations('assistant.variants');
  const bodyId = useId();
  const { progress, phase, slides } = run;
  const running = phase === 'running';
  const superseded = phase === 'cancelled' && !latest;
  // null — как решает сборка: раскрыта, пока идёт. Нажатие закрепляет выбор человека.
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const open = expanded ?? running;
  const [gallery, setGallery] = useState<{ start: number; key: number } | null>(null);
  const now = useNow(running);
  const elapsed = (run.finishedAt ?? now) - run.startedAt;

  const current = progress.stages.find((stage) => stage.state === 'running');
  const status =
    phase === 'done'
      ? t('done')
      : phase === 'failed'
        ? t('failed')
        : phase === 'cancelled'
          ? t(superseded ? 'superseded' : 'cancelled')
          : current?.stage === 'laying-out' && current.total !== null
            ? t('layingOut', { done: current.done ?? 0, total: current.total })
            : current
              ? t('stage', { stage: t(`stages.${current.stage}`) })
              : t('starting');

  const layingOut = progress.stages.find((stage) => stage.stage === 'laying-out');
  const total = slides[0]?.total ?? layingOut?.total ?? null;
  const variant = slides[0]?.slide.variant;
  const designSystem = slides[0]?.designSystem;
  const failure = phase === 'failed' ? run.failure?.message || t('failedUnknown') : null;
  const retryable =
    (phase === 'cancelled' && !superseded) || (phase === 'failed' && run.failure?.retryable);

  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl bg-card ring-1 ring-border',
        phase === 'failed' && 'ring-destructive/40',
        superseded && 'opacity-70',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setExpanded(!open)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        <StatusMark phase={phase} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={cn(
              'truncate text-sm font-medium',
              running ? 'assistant-shimmer' : 'text-foreground',
            )}
          >
            {status}
          </span>
          {total !== null && variant ? (
            <span className="truncate text-xs text-muted-foreground">
              {tb('variantNote', { variant: tv(`${variant}.name`), count: total })}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {running
            ? tb('elapsed', {
                time: formatElapsed(elapsed),
                budget: formatElapsed(GENERATION_BUDGET_MS),
              })
            : phase === 'done'
              ? tb('doneIn', { time: formatElapsed(elapsed) })
              : null}
        </span>
        <ChevronDownIcon
          size={14}
          aria-hidden
          className={cn(
            'shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </button>
      <div
        role="progressbar"
        aria-label={t('progress')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
        className={cn('h-0.5 bg-muted transition-opacity duration-500', !running && 'opacity-0')}
      >
        <div
          className="h-full bg-[var(--aurora-color,var(--foreground))] transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${progress.percent}%` }}
        />
      </div>

      <div
        id={bodyId}
        className={cn(
          'grid transition-[grid-template-rows] duration-300 motion-reduce:transition-none',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <ol aria-label={tb('stages')} className="flex flex-wrap gap-1.5 px-4 pt-3">
            {progress.stages.map((stage) => (
              <StageChip key={stage.stage} stage={stage} />
            ))}
          </ol>
          {total !== null && designSystem ? (
            <ol
              aria-label={tb('slides')}
              className="grid grid-cols-2 gap-2.5 p-4 sm:grid-cols-3 lg:grid-cols-4"
            >
              {Array.from({ length: total }, (_, at) => {
                const item = slides[at];
                return (
                  <li key={at} className="min-w-0">
                    {item ? (
                      <button
                        type="button"
                        onClick={() => setGallery({ start: at, key: Date.now() })}
                        aria-label={tb('slide', { number: at + 1 })}
                        className={cn(
                          'assistant-reveal block w-full overflow-hidden rounded-md ring-1 ring-border outline-none motion-reduce:animate-none',
                          'transition-shadow duration-100 hover:ring-foreground/40 focus-visible:ring-2 focus-visible:ring-ring',
                        )}
                      >
                        <SlideView slide={item.slide} profile={item.designSystem} thumbnail />
                      </button>
                    ) : (
                      <span
                        aria-hidden
                        className="assistant-skeleton block aspect-video rounded-md bg-muted/60"
                      />
                    )}
                  </li>
                );
              })}
            </ol>
          ) : running ? (
            <p className="flex items-center gap-2 px-4 py-4 text-xs text-muted-foreground">
              <SpinnerIcon
                size={13}
                className="animate-spin motion-reduce:animate-none"
                aria-hidden
              />
              {tb('planning')}
            </p>
          ) : (
            <div className="h-3" />
          )}
          {progress.warnings.length > 0 ? (
            <ul className="flex flex-col gap-1 border-t border-border px-4 py-3 text-xs text-muted-foreground">
              {progress.warnings.map((warning, at) => (
                <li key={`${warning.code}-${at}`} className="flex gap-2">
                  <WarningIcon
                    size={13}
                    className="mt-0.5 shrink-0 text-(--project-yellow)"
                    aria-hidden
                  />
                  {warning.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {failure !== null || retryable ? (
        <div className="flex items-center gap-2 border-t border-border px-4 py-2.5">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">{failure}</p>
          {retryable ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => generationRuns.retry(run.runId)}
            >
              <RetryIcon data-icon="inline-start" />
              {t('retry')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {gallery && designSystem ? (
        <SlidesDialog
          key={gallery.key}
          open
          onOpenChange={(next) => {
            if (!next) setGallery(null);
          }}
          title={tb('galleryTitle')}
          description={
            variant ? tb('galleryNote', { variant: tv(`${variant}.name`) }) : tb('galleryTitle')
          }
          slides={slides.map((item) => item.slide)}
          designSystem={designSystem}
          start={gallery.start}
        />
      ) : null}
    </div>
  );
}

function StatusMark({ phase }: { phase: GenerationRun['phase'] }) {
  if (phase === 'failed') {
    return <WarningIcon size={16} className="shrink-0 text-destructive" aria-hidden />;
  }
  if (phase === 'done') {
    return (
      <span
        aria-hidden
        className="grid size-5 shrink-0 place-items-center rounded-full bg-foreground text-background"
      >
        <CheckIcon size={12} className="[--icon-stroke:2]" />
      </span>
    );
  }
  return (
    <span aria-hidden className="grid size-5 shrink-0 place-items-center">
      <span
        className={cn(
          'size-2 rounded-full',
          phase === 'running'
            ? 'assistant-ping bg-[var(--aurora-color,var(--foreground))]'
            : 'bg-muted-foreground',
        )}
      />
    </span>
  );
}

function StageChip({ stage }: { stage: GenerationStage }) {
  const t = useTranslations('assistant.work');
  const count =
    stage.state === 'running' && stage.total !== null && stage.total > 1
      ? t('stageCount', { done: stage.done ?? 0, total: stage.total })
      : null;
  return (
    <li
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full py-1 pr-2.5 pl-2 text-xs ring-1',
        stage.state === 'pending' && 'text-muted-foreground ring-border',
        stage.state === 'running' && 'text-foreground ring-foreground/60',
        stage.state === 'done' && 'text-foreground ring-border',
        stage.state === 'failed' && 'text-destructive ring-destructive/40',
      )}
    >
      <span className="grid size-3.5 place-items-center" aria-hidden>
        {stage.state === 'done' ? (
          <CheckIcon size={12} className="[--icon-stroke:2]" />
        ) : stage.state === 'running' ? (
          <SpinnerIcon size={12} className="animate-spin motion-reduce:animate-none" />
        ) : stage.state === 'failed' ? (
          <WarningIcon size={12} />
        ) : (
          <span className="size-1 rounded-full bg-current opacity-60" />
        )}
      </span>
      {t(`stages.${stage.stage}`)}
      <span className="sr-only">, {t(`stageStates.${stage.state}`)}</span>
      {count ? <span className="text-muted-foreground tabular-nums">{count}</span> : null}
    </li>
  );
}
