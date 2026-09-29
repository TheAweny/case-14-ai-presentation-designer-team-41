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
import type { GenerationRun, GenerationPhase } from '@/lib/generation-runs';
import { cn } from '@/lib/utils';
import { formatElapsed, useNow } from './elapsed';
import { generationRuns, useRun } from './session';
import { runStatus } from './run-status';
import { SlidesDialog } from './slides-dialog';
import { useRunStatusText } from './thread-messages';

/**
 * Ход сборки на странице разговора — лентой шагов, как работа агента в Codex: сверху строка-сводка
 * (что происходит и сколько прошло из бюджета), под ней этапы пайплайна с тем, чем каждый занят
 * сейчас, и слайды, которые появляются под этапом вёрстки. Пока сборка идёт, шаги раскрыты;
 * готова — сворачиваются в строку «Собрал колоду за 0:04»: итог ниже показывает все три варианта.
 *
 * Сборку, которую сменила новая, повторять незачем: она подписана и без кнопки повтора.
 */
export function BuildCard({
  runId,
  latest,
  unfinished = false,
  retry = true,
}: {
  runId: string;
  latest: boolean;
  /**
   * Сборка ещё не отдала итог. Если её прогона во вкладке нет — страницу обновили посреди
   * сборки, и следить за ней отсюда нельзя: карточка честно говорит, где искать результат.
   */
  unfinished?: boolean;
  /** Повтор из карточки. Сборку, которую запустил агент, перезапускает он, а не карточка. */
  retry?: boolean;
}) {
  const t = useTranslations('assistant.work');
  const run = useRun(runId);
  if (!run) {
    return unfinished ? (
      <p className="text-xs text-pretty text-muted-foreground">{t('lostAfterReload')}</p>
    ) : null;
  }
  return <BuildCardView run={run} latest={latest} retry={retry} />;
}

function BuildCardView({
  run,
  latest,
  retry,
}: {
  run: GenerationRun;
  latest: boolean;
  retry: boolean;
}) {
  const t = useTranslations('assistant.work');
  const tb = useTranslations('assistant.build');
  const statusText = useRunStatusText();
  const stepsId = useId();
  const { progress, phase } = run;
  const running = phase === 'running';
  const superseded = phase === 'cancelled' && !latest;
  // null — как решает сборка: раскрыта, пока идёт. Нажатие закрепляет выбор человека.
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const open = expanded ?? running;
  const now = useNow(running);
  const elapsed = (run.finishedAt ?? now) - run.startedAt;

  const title =
    phase === 'done'
      ? tb('doneTitle', { time: formatElapsed(elapsed) })
      : statusText(runStatus(run, latest));
  const failure = phase === 'failed' ? run.failure?.message || t('failedUnknown') : null;
  const retryable =
    retry &&
    ((phase === 'cancelled' && !superseded) || (phase === 'failed' && run.failure?.retryable));

  return (
    <section className={cn('flex flex-col gap-1', superseded && 'opacity-60')}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={stepsId}
        onClick={() => setExpanded(!open)}
        className={cn(
          'group flex max-w-full items-center gap-2 self-start rounded-md py-1 pr-1 text-left text-[0.8125rem] outline-none',
          'text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
          phase === 'failed' && 'text-destructive hover:text-destructive',
        )}
      >
        <PhaseGlyph phase={phase} />
        <span className={cn('min-w-0 truncate', running && 'assistant-shimmer')}>{title}</span>
        {running ? (
          <span className="shrink-0 tabular-nums opacity-70">
            {tb('elapsed', {
              time: formatElapsed(elapsed),
              budget: formatElapsed(GENERATION_BUDGET_MS),
            })}
          </span>
        ) : null}
        <ChevronDownIcon
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 opacity-60 transition-transform duration-200 motion-reduce:transition-none',
            open ? 'rotate-0' : '-rotate-90',
          )}
        />
      </button>

      <div
        id={stepsId}
        className={cn(
          'grid transition-[grid-template-rows] duration-300 motion-reduce:transition-none',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <ol
            aria-label={tb('stages')}
            className="ml-[7px] flex flex-col gap-2 border-l border-border py-1.5 pl-4"
          >
            {progress.stages.map((stage) => (
              <StepRow key={stage.stage} stage={stage} run={run} />
            ))}
            {progress.warnings.map((warning, at) => (
              <li
                key={`${warning.code}-${at}`}
                className="flex gap-2 text-[0.8125rem] text-muted-foreground"
              >
                <WarningIcon
                  aria-hidden
                  className="mt-0.5 size-3.5 shrink-0 text-(--project-yellow)"
                />
                {warning.message}
              </li>
            ))}
          </ol>
        </div>
      </div>

      {failure !== null || retryable ? (
        <div className="flex items-center gap-3 pl-6">
          {failure !== null ? (
            <p className="min-w-0 text-[0.8125rem] text-muted-foreground">{failure}</p>
          ) : null}
          {retryable ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => generationRuns.retry(run.runId)}
            >
              <RetryIcon data-icon="inline-start" />
              {t('retry')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Знак сборки в строке-сводке: идёт, готова, сбой или остановлена. */
function PhaseGlyph({ phase }: { phase: GenerationPhase }) {
  if (phase === 'running') {
    return (
      <SpinnerIcon
        aria-hidden
        className="size-3.5 shrink-0 animate-spin text-[var(--aurora-color,var(--foreground))] motion-reduce:animate-none"
      />
    );
  }
  if (phase === 'done') return <CheckIcon aria-hidden className="size-3.5 shrink-0" />;
  if (phase === 'failed') return <WarningIcon aria-hidden className="size-3.5 shrink-0" />;
  return (
    <span aria-hidden className="grid size-3.5 shrink-0 place-items-center">
      ·
    </span>
  );
}

/**
 * Шаг ленты: этап пайплайна, его состояние и чем он занят. У вёрстки под строкой растут слайды —
 * по нажатию они открываются крупно.
 */
function StepRow({ stage, run }: { stage: GenerationStage; run: GenerationRun }) {
  const t = useTranslations('assistant.work');
  const tb = useTranslations('assistant.build');
  const tv = useTranslations('assistant.variants');
  const [gallery, setGallery] = useState<{ start: number; key: number } | null>(null);
  const running = stage.state === 'running';
  const count =
    running && stage.total !== null && stage.total > 1
      ? t('stageCount', { done: stage.done ?? 0, total: stage.total })
      : null;
  const detail = running ? stage.note || count : null;

  const { slides } = run;
  const layingOut = stage.stage === 'laying-out';
  const total = slides[0]?.total ?? stage.total ?? null;
  const designSystem = slides[0]?.designSystem;
  const variant = slides[0]?.slide.variant;
  const showSlides = layingOut && stage.state !== 'pending' && total !== null && designSystem;

  return (
    <li className="flex flex-col gap-2">
      <p
        className={cn(
          'flex min-w-0 items-center gap-2 text-[0.8125rem]',
          stage.state === 'pending' ? 'text-muted-foreground/70' : 'text-muted-foreground',
          running && 'text-foreground',
          stage.state === 'failed' && 'text-destructive',
        )}
      >
        <span aria-hidden className="grid size-3.5 shrink-0 place-items-center">
          {stage.state === 'done' ? (
            <CheckIcon className="size-3.5" />
          ) : running ? (
            <SpinnerIcon className="size-3.5 animate-spin motion-reduce:animate-none" />
          ) : stage.state === 'failed' ? (
            <WarningIcon className="size-3.5" />
          ) : (
            <span className="size-1 rounded-full bg-current opacity-60" />
          )}
        </span>
        <span className="shrink-0">{t(`stages.${stage.stage}`)}</span>
        <span className="sr-only">, {t(`stageStates.${stage.state}`)}</span>
        {detail ? (
          <span className="min-w-0 truncate text-muted-foreground">
            <span aria-hidden>· </span>
            {detail}
          </span>
        ) : null}
        {running && count && stage.note ? (
          <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">{count}</span>
        ) : null}
      </p>

      {showSlides ? (
        <ol
          aria-label={
            variant
              ? tb('variantNote', { variant: tv(`${variant}.name`), count: total })
              : tb('slides')
          }
          className="grid grid-cols-3 gap-2 pl-5.5 sm:grid-cols-4"
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
    </li>
  );
}
