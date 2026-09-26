'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Alert02Icon,
  ArrowDown01Icon,
  Loading03Icon,
  RefreshIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import type { DesignSystem, TypeRole } from '@lct/contracts';
import { SlideView } from '@lct/slide-renderer';
import { AttachmentChip } from '@/components/composer/attachment-chip';
import { PaletteStrip, primaryFontOf } from '@/components/library/template-swatch';
import { TemplateCover, templateThumbOf } from '@/components/project/template-thumb';
import { Button } from '@/components/ui/button';
import type { AgentText, AssistantQuestion, ThreadMessage } from '@/lib/assistant-threads';
import type { GenerationProgress, GenerationStage } from '@/lib/deck-generator';
import type { TemplateSummary } from '@/lib/library-source';
import { cn } from '@/lib/utils';
import {
  assistantThreads,
  generationRuns,
  templateImporter,
  templateImports,
  useRun,
  useTemplateImport,
  useThread,
} from './session';
import { useSlideRefLabels } from './slide-ref-label';

type Ask = Extract<ThreadMessage, { kind: 'ask' }>;

/**
 * Реплика человека: вложения чипами, как они лежали в поле, текст пузырём справа и под ним то,
 * чем собирать.
 */
export function UserMessage({ message }: { message: Extract<ThreadMessage, { kind: 'user' }> }) {
  const t = useTranslations('assistant.user');
  const { meta } = message;
  const tags = meta
    ? [
        meta.templateName,
        meta.slideCount === null ? t('slidesAuto') : t('slides', { count: meta.slideCount }),
        ...(meta.modelName ? [meta.modelName] : []),
      ]
    : [];
  return (
    <div className="flex max-w-[88%] flex-col items-end gap-1.5 self-end">
      {message.attachments.length > 0 ? (
        <ul className="flex flex-wrap justify-end gap-1.5" aria-label={t('attachments')}>
          {message.attachments.map((attachment, index) => (
            <AttachmentChip key={`${attachment.kind}-${index}`} attachment={attachment} />
          ))}
        </ul>
      ) : null}
      {message.text ? (
        <p className="rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-[0.8125rem]/relaxed whitespace-pre-wrap text-foreground">
          {message.text}
        </p>
      ) : null}
      {tags.length > 0 ? (
        <ul className="flex flex-wrap justify-end gap-1" aria-label={t('settings')}>
          {tags.map((tag) => (
            <li
              key={tag}
              className="rounded-full px-2 py-px text-[0.6875rem] text-muted-foreground ring-1 ring-border"
            >
              {tag}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Реплика агента: ключ словаря с параметрами или готовый текст модели. */
export function AgentMessage({ text }: { text: AgentText }) {
  const t = useTranslations('assistant.agent');
  const tv = useTranslations('assistant.variants');
  const format = useFormatter();
  const { mention } = useSlideRefLabels();
  let content: string;
  if ('raw' in text) content = text.raw;
  else if (text.key === 'contextSeen') {
    const items = text.seen.map((item) => mention(item.subject, item.slideNumber));
    content = t('contextSeen', { items: format.list(items, { type: 'conjunction' }) });
  } else if (text.key === 'opened' || text.key === 'openedNoProject') {
    const variant = text.values?.variant ?? 'balanced';
    content = t(text.key, {
      variant: tv(`${variant as 'dense' | 'balanced' | 'airy'}.name`),
    });
  } else if (text.key === 'building' || text.key === 'templateImportFailed') {
    content = t(text.key, { template: text.values?.template ?? '' });
  } else if (text.key === 'templateAttached' || text.key === 'templateAttachFailed') {
    content = t(text.key, { project: text.values?.project ?? '' });
  } else content = t(text.key);
  return <p className="text-[0.8125rem]/relaxed text-foreground">{content}</p>;
}

/**
 * Ход генерации одной строкой: что происходит сейчас и сколько готово. Этапы раскрываются по
 * нажатию. Сбой и остановка — здесь же, с повтором.
 */
export function WorkCard({ runId }: { runId: string }) {
  const t = useTranslations('assistant.work');
  const run = useRun(runId);
  if (!run) return null;

  const { progress, phase } = run;
  const current = progress.stages.find((stage) => stage.state === 'running');
  const status =
    phase === 'done'
      ? t('done')
      : phase === 'failed'
        ? t('failed')
        : phase === 'cancelled'
          ? t('cancelled')
          : current?.stage === 'laying-out' && current.total !== null
            ? t('layingOut', { done: current.done ?? 0, total: current.total })
            : current
              ? t('stage', { stage: t(`stages.${current.stage}`) })
              : t('starting');

  return (
    <ProgressCard
      phase={phase}
      progress={progress}
      status={status}
      progressLabel={t('progress')}
      failure={phase === 'failed' ? run.failure?.message || t('failedUnknown') : null}
      retry={
        phase === 'cancelled' || (phase === 'failed' && run.failure?.retryable)
          ? { label: t('retry'), onRetry: () => generationRuns.retry(runId) }
          : null
      }
    />
  );
}

/**
 * Ход разбора шаблона — тот же вид, что у хода генерации: строка состояния, полоска и этапы
 * `parsing-template`/`profiling-template` по нажатию. Повторяемый сбой повторяется отсюда, и
 * разговор продолжается с того же места.
 */
export function ImportCard({ importId }: { importId: string }) {
  const t = useTranslations('assistant.import');
  const item = useTemplateImport(importId);
  if (!item) return null;

  const { phase, progress, failure } = item;
  const template = item.file.name;
  const status =
    phase === 'done'
      ? t('done', { template })
      : phase === 'failed'
        ? t('failed', { template })
        : t('running', { template });

  return (
    <ProgressCard
      phase={phase}
      progress={progress}
      status={status}
      progressLabel={t('progress')}
      failure={phase === 'failed' ? failure?.message || t('failedUnknown') : null}
      retry={
        phase === 'failed' && failure?.retryable !== false
          ? { label: t('retry'), onRetry: () => templateImports.retry(importId) }
          : null
      }
    />
  );
}

/**
 * Карточка долгой работы агента: строка состояния с процентом, тонкая полоска хода и этапы,
 * которые раскрываются по нажатию. Внизу — причина сбоя и повтор, если он возможен.
 */
function ProgressCard({
  phase,
  progress,
  status,
  progressLabel,
  failure,
  retry,
}: {
  phase: string;
  progress: GenerationProgress;
  status: string;
  progressLabel: string;
  /** Причина сбоя; null — сбоя нет. */
  failure: string | null;
  /** Повтор: после сбоя или остановки; null — повторять нечего или нельзя. */
  retry: { readonly label: string; readonly onRetry: () => void } | null;
}) {
  const [open, setOpen] = useState(false);
  const stagesId = useId();
  const running = phase === 'running';

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl ring-1 ring-border',
        phase === 'failed' && 'ring-destructive/40',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={stagesId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[0.8125rem] outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        <StatusDot phase={phase} />
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            running ? 'assistant-shimmer' : 'text-foreground',
          )}
        >
          {status}
        </span>
        {running ? (
          <span className="text-xs text-muted-foreground tabular-nums">{progress.percent}%</span>
        ) : null}
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={14}
          strokeWidth={2}
          className={cn(
            'text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </button>
      <div
        role="progressbar"
        aria-label={progressLabel}
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
        id={stagesId}
        className={cn(
          'grid transition-[grid-template-rows] duration-300 motion-reduce:transition-none',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <ol className={cn('overflow-hidden px-3', open && 'pt-1 pb-2.5')}>
          {progress.stages.map((stage) => (
            <StageRow key={stage.stage} stage={stage} />
          ))}
        </ol>
      </div>
      {failure !== null || retry ? (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          {failure !== null ? (
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">{failure}</p>
          ) : (
            <span className="flex-1" />
          )}
          {retry ? (
            <Button type="button" variant="outline" size="sm" onClick={retry.onRetry}>
              <HugeiconsIcon icon={RefreshIcon} strokeWidth={1.75} data-icon="inline-start" />
              {retry.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
function StatusDot({ phase }: { phase: string }) {
  if (phase === 'failed') {
    return (
      <HugeiconsIcon
        icon={Alert02Icon}
        size={14}
        strokeWidth={1.75}
        className="shrink-0 text-destructive"
        aria-hidden
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        'size-2 shrink-0 rounded-full',
        phase === 'running'
          ? 'assistant-ping bg-[var(--aurora-color,var(--foreground))]'
          : 'bg-muted-foreground',
      )}
    />
  );
}

function StageRow({ stage }: { stage: GenerationStage }) {
  const t = useTranslations('assistant.work');
  const count =
    stage.total !== null && stage.total > 1
      ? t('stageCount', { done: stage.done ?? 0, total: stage.total })
      : null;
  return (
    <li
      className={cn(
        'flex items-center gap-2.5 py-1 text-xs',
        stage.state === 'pending' ? 'text-muted-foreground' : 'text-foreground',
        stage.state === 'failed' && 'text-destructive',
      )}
    >
      <span className="grid size-3.5 shrink-0 place-items-center" aria-hidden>
        {stage.state === 'done' ? (
          <HugeiconsIcon icon={Tick02Icon} size={13} strokeWidth={2} />
        ) : stage.state === 'running' ? (
          <HugeiconsIcon
            icon={Loading03Icon}
            size={13}
            strokeWidth={1.75}
            className="animate-spin motion-reduce:animate-none"
          />
        ) : (
          <span className="size-1 rounded-full bg-muted-foreground/60" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        {t(`stages.${stage.stage}`)}
        <span className="sr-only">, {t(`stageStates.${stage.state}`)}</span>
      </span>
      {count ? <span className="text-muted-foreground tabular-nums">{count}</span> : null}
    </li>
  );
}

/** Шрифт первой роли шкалы, которая есть в профиле; ни одной — null. */
function fontOfRoles(system: DesignSystem, roles: readonly TypeRole[]): string | null {
  for (const role of roles) {
    const style = system.typeScale.find((item) => item.role === role);
    if (style) return style.font;
  }
  return null;
}

/**
 * Итог разбора шаблона, компактно: титульный макет, имя файла, сколько макетов, палитра и шрифты
 * заголовков и текста. Всё — из профиля шаблона: карточка ничего не красит сама.
 *
 * Демо профиль из файла не извлекает, а генератор демо на новом шаблоне берёт чужие колоды — и
 * карточка говорит об этом одной приглушённой строкой, а не делает вид, что файл разобран.
 */
export function TemplateCard({
  template,
  threadId,
}: {
  template: TemplateSummary;
  /** Разговор карточки: по его прогону видно, подменил ли генератор шаблон. */
  threadId: string;
}) {
  const t = useTranslations('assistant.template');
  const thread = useThread(threadId);
  const work = thread?.messages.findLast((message) => message.kind === 'work');
  const run = useRun(work?.kind === 'work' ? work.runId : null);
  const demo = !templateImporter.profilesFiles || run?.result?.templateSubstituted === true;

  const { designSystem } = template;
  const primary = primaryFontOf(designSystem);
  const heading = fontOfRoles(designSystem, ['title', 'heading']) ?? primary;
  const body = fontOfRoles(designSystem, ['body', 'bullet']) ?? primary;
  const fonts =
    heading && body && heading !== body
      ? t('fonts', { heading, body })
      : heading || body
        ? t('font', { font: heading ?? body ?? '' })
        : null;

  return (
    <div className="flex flex-col gap-2 rounded-xl p-2 ring-1 ring-border">
      <div className="flex min-w-0 items-center gap-3">
        <TemplateCover template={templateThumbOf(template)} className="w-24 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="truncate text-[0.8125rem] font-medium text-foreground">
            {template.fileName}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {t('layouts', { count: template.layouts.length })}
          </p>
          <PaletteStrip system={designSystem} className="h-2 w-full max-w-36" />
        </div>
      </div>
      {fonts ? <p className="truncate px-0.5 text-xs text-muted-foreground">{fonts}</p> : null}
      {demo ? (
        <p className="px-0.5 text-[0.6875rem]/snug text-muted-foreground/80">{t('demoProfile')}</p>
      ) : null}
    </div>
  );
}

interface OptionView {
  readonly optionId: string;
  readonly label: string;
  readonly description: string;
  readonly preview?: Extract<
    AssistantQuestion,
    { questionId: 'variant' }
  >['options'][number]['preview'];
}

/**
 * Вопрос агента с вариантами, как `AskUserQuestion`: цифры выбирают, Enter подтверждает, а свой
 * ответ можно написать в поле панели. У вопроса о варианте вёрстки — миниатюры, и наведённый
 * вариант показывается на холсте.
 */
export function AskCard({
  threadId,
  message,
  onPreview,
}: {
  threadId: string;
  message: Ask;
  /** Вариант под указателем или выбранный — его показывает холст. */
  onPreview?: (optionId: string | null) => void;
}) {
  const t = useTranslations('assistant.ask');
  const tq = useTranslations('assistant.questions');
  const tv = useTranslations('assistant.variants');
  const { question, answer } = message;
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);

  const options = useMemo<readonly OptionView[]>(
    () =>
      question.questionId === 'variant'
        ? question.options.map((option) => ({
            optionId: option.optionId,
            label: tv(`${option.optionId}.name`),
            description: tv(`${option.optionId}.description`),
            preview: option.preview,
          }))
        : question.questionId === 'attachTemplate'
          ? question.options.map((option) => ({
              optionId: option.optionId,
              label: tq(`attachTemplate.options.${option.optionId}.label`, {
                project: question.projectName,
              }),
              description: tq(`attachTemplate.options.${option.optionId}.description`),
            }))
          : question.options.map((option) => ({
              optionId: option.optionId,
              label: tq(`audience.options.${option.optionId}.label`),
              description: tq(`audience.options.${option.optionId}.description`),
            })),
    [question, tq, tv],
  );
  // Подставляется в заголовок вопроса; у вопросов без параметров лишнее значение не мешает.
  const titleValues = {
    project: question.questionId === 'attachTemplate' ? question.projectName : '',
  };
  const initial =
    'defaultOptionId' in question
      ? options.findIndex((option) => option.optionId === question.defaultOptionId)
      : -1;
  const [pick, setPick] = useState(initial);
  const answered = answer !== null;
  const chosen = answered
    ? options.findIndex((option) => option.optionId === answer.optionId)
    : pick;
  const visual = question.questionId === 'variant';

  const confirm = (index = pick) => {
    const option = options[index];
    if (answered || !option) return;
    assistantThreads.answer(threadId, message.id, {
      optionId: option.optionId,
      text: option.label,
    });
  };

  // Цифры выбирают вариант, пока вопрос ждёт ответа и человек не печатает в поле.
  useEffect(() => {
    if (answered) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, [contenteditable]')) return;
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < options.length) {
        event.preventDefault();
        setPick(index);
        onPreview?.(options[index]?.optionId ?? null);
        box.current?.querySelectorAll<HTMLElement>('[role=radio]')[index]?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [answered, options, onPreview]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && !answered && pick >= 0) {
      event.preventDefault();
      confirm();
    }
  };

  return (
    <div
      ref={box}
      role="group"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      className={cn(
        'rounded-2xl bg-card/70 p-3 ring-1 ring-border transition-opacity duration-300',
        answered && 'opacity-60',
      )}
    >
      <p id={titleId} className="text-[0.8125rem] font-semibold text-foreground">
        {tq(`${question.questionId}.title`, titleValues)}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{tq(`${question.questionId}.note`)}</p>
      <div
        role="radiogroup"
        aria-labelledby={titleId}
        className="mt-2.5 flex flex-col gap-1.5"
        onMouseLeave={() => onPreview?.(options[pick]?.optionId ?? null)}
      >
        {options.map((option, index) => {
          const checked = chosen === index;
          return (
            <button
              key={option.optionId}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={answered}
              onClick={() => {
                setPick(index);
                onPreview?.(option.optionId);
              }}
              onDoubleClick={() => confirm(index)}
              onMouseEnter={() => onPreview?.(option.optionId)}
              onFocus={() => onPreview?.(option.optionId)}
              className={cn(
                'grid items-center gap-x-2.5 rounded-xl px-2.5 py-2 text-left outline-none',
                'ring-1 ring-border transition-[box-shadow,background-color] duration-100 motion-reduce:transition-none',
                'enabled:hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring',
                'aria-checked:bg-muted/50 aria-checked:ring-[1.5px] aria-checked:ring-foreground',
                visual ? 'grid-cols-[5.5rem_1fr_auto] py-1.5 pl-1.5' : 'grid-cols-[auto_1fr]',
              )}
            >
              {visual && option.preview ? (
                <span
                  aria-hidden
                  className="row-span-2 overflow-hidden rounded-md ring-1 ring-border"
                >
                  <SlideView
                    slide={option.preview.slide}
                    profile={option.preview.designSystem}
                    thumbnail
                  />
                </span>
              ) : null}
              <kbd
                aria-hidden
                className={cn(
                  'row-span-2 grid size-5 place-items-center rounded-md font-mono text-[0.6875rem] text-muted-foreground ring-1 ring-border',
                  checked && 'bg-foreground text-background ring-0',
                  visual && 'col-start-3',
                )}
              >
                {index + 1}
              </kbd>
              <span
                className={cn(
                  'text-[0.8125rem] font-medium text-foreground',
                  visual ? 'col-start-2 row-start-1' : 'col-start-2',
                )}
              >
                {option.label}
              </span>
              <span
                className={cn(
                  'text-xs text-muted-foreground',
                  visual ? 'col-start-2 row-start-2' : 'col-start-2',
                )}
              >
                {option.description}
              </span>
            </button>
          );
        })}
      </div>
      {answered ? null : (
        <div className="mt-2.5 flex items-center gap-2">
          <span className="mr-auto text-[0.6875rem] text-muted-foreground">
            {t('keys', { count: options.length })}
          </span>
          <Button type="button" size="sm" disabled={pick < 0} onClick={() => confirm()}>
            {visual && options[pick]
              ? t('keep', { variant: options[pick]?.label ?? '' })
              : t('answer')}
          </Button>
        </div>
      )}
    </div>
  );
}
