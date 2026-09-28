'use client';

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  EditIcon,
  PeopleIcon,
  RetryIcon,
  SpinnerIcon,
  WarningIcon,
} from '@/components/ui/icons';
import type { DesignSystem, TypeRole } from '@lct/contracts';
import { AttachmentChip } from '@/components/composer/attachment-chip';
import { PaletteStrip, primaryFontOf } from '@/components/library/template-swatch';
import { TemplateCover, templateThumbOf } from '@/components/project/template-thumb';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AUDIENCE_OPTIONS,
  type AgentText,
  type AudienceOption,
  type ThreadMessage,
} from '@/lib/assistant-threads';
import type { GenerationProgress, GenerationStage } from '@/lib/deck-generator';
import { templateTitle } from '@/lib/composer-templates';
import type { TemplateSummary } from '@/lib/library-source';
import { cn } from '@/lib/utils';
import {
  assistantThreads,
  deckConversations,
  generationRuns,
  templateImporter,
  templateImports,
  useRun,
  useTemplateImport,
  useThread,
} from './session';
import { runStatus, type RunStatus } from './run-status';
import { useSlideRefLabels } from './slide-ref-label';

type Ask = Extract<ThreadMessage, { kind: 'ask' }>;

/**
 * Плотность разговора. Панель редактора узкая, и текст в ней мельче; страница разговора — место
 * для чтения, текст там крупнее. Карточки от плотности не зависят.
 */
export type ThreadDensity = 'compact' | 'comfortable';

export const ThreadDensityContext = createContext<ThreadDensity>('compact');

/** Размер текста реплик при данной плотности. */
function useMessageText(): string {
  return useContext(ThreadDensityContext) === 'comfortable'
    ? 'text-[0.9375rem]/relaxed'
    : 'text-[0.8125rem]/relaxed';
}

/**
 * Реплика человека: вложения чипами, как они лежали в поле, текст пузырём справа и под ним то,
 * чем собирать. При наведении — «Копировать» и «Изменить»: второе возвращает текст в поле, чтобы
 * поправить и отправить заново.
 */
export function UserMessage({
  message,
  onEdit,
}: {
  message: Extract<ThreadMessage, { kind: 'user' }>;
  /** Вернуть текст в поле; без обработчика «Изменить» нет. */
  onEdit?: (text: string) => void;
}) {
  const t = useTranslations('assistant.user');
  const text = useMessageText();
  const { meta } = message;
  const tags = meta
    ? [
        templateTitle(meta.templateName),
        meta.slideCount === null ? t('slidesAuto') : t('slides', { count: meta.slideCount }),
        ...(meta.modelName ? [meta.modelName] : []),
      ]
    : [];
  return (
    <div className="group/message flex max-w-[88%] flex-col items-end gap-1.5 self-end">
      {message.attachments.length > 0 ? (
        <ul className="flex flex-wrap justify-end gap-1.5" aria-label={t('attachments')}>
          {message.attachments.map((attachment, index) => (
            <AttachmentChip key={`${attachment.kind}-${index}`} attachment={attachment} />
          ))}
        </ul>
      ) : null}
      {message.text ? (
        <p
          className={cn(
            'rounded-2xl rounded-br-md bg-muted px-3.5 py-2 whitespace-pre-wrap text-foreground',
            text,
          )}
        >
          {message.text}
        </p>
      ) : null}
      {tags.length > 0 ? (
        // Чем собирали — тихой строкой, а не чипами: нажимать тут нечего.
        <p className="px-1 text-right text-[0.6875rem] text-muted-foreground">
          <span className="sr-only">{t('settings')}: </span>
          {tags.filter(Boolean).join(' · ')}
        </p>
      ) : null}
      {message.text ? (
        <MessageActions
          text={message.text}
          onEdit={onEdit ? () => onEdit(message.text) : undefined}
        />
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

/** Реплика агента: ключ словаря с параметрами или готовый текст модели. */
export function AgentMessage({ text }: { text: AgentText }) {
  const t = useTranslations('assistant.agent');
  const size = useMessageText();
  const format = useFormatter();
  const { mention } = useSlideRefLabels();
  let content: string;
  if ('raw' in text) content = text.raw;
  else if (text.key === 'contextSeen') {
    const items = text.seen.map((item) => mention(item.subject, item.slideNumber));
    content = t('contextSeen', { items: format.list(items, { type: 'conjunction' }) });
  } else if (text.key === 'building' || text.key === 'templateImportFailed') {
    content = t(text.key, { template: text.values?.template ?? '' });
  } else if (text.key === 'templateAttached' || text.key === 'templateAttachFailed') {
    content = t(text.key, { project: text.values?.project ?? '' });
  } else content = t(text.key);
  return <p className={cn('text-foreground', size)}>{content}</p>;
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

/**
 * Ход генерации одной строкой: что происходит сейчас и сколько готово. Этапы раскрываются по
 * нажатию. Сбой и остановка — здесь же, с повтором.
 */
export function WorkCard({ runId, latest }: { runId: string; latest: boolean }) {
  const t = useTranslations('assistant.work');
  const statusText = useRunStatusText();
  const run = useRun(runId);
  if (!run) return null;

  const { progress, phase } = run;
  // Отменённую сборку сменила новая: запускать её снова незачем.
  const superseded = phase === 'cancelled' && !latest;
  const status = statusText(runStatus(run, latest));

  return (
    <ProgressCard
      phase={phase}
      progress={progress}
      status={status}
      progressLabel={t('progress')}
      failure={phase === 'failed' ? run.failure?.message || t('failedUnknown') : null}
      retry={
        (phase === 'cancelled' && !superseded) || (phase === 'failed' && run.failure?.retryable)
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
        <ChevronDownIcon
          size={14}
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
              <RetryIcon data-icon="inline-start" />
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
    return <WarningIcon size={14} className="shrink-0 text-destructive" aria-hidden />;
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
          <CheckIcon size={13} />
        ) : stage.state === 'running' ? (
          <SpinnerIcon size={13} className="animate-spin motion-reduce:animate-none" />
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
}

/**
 * Вопрос агента с вариантами, как `AskUserQuestion`: цифры выбирают, Enter подтверждает, а свой
 * ответ можно написать в поле.
 */
export function AskCard({ threadId, message }: { threadId: string; message: Ask }) {
  const t = useTranslations('assistant.ask');
  const tq = useTranslations('assistant.questions');
  const { question, answer } = message;
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);

  const options = useMemo<readonly OptionView[]>(
    () =>
      question.options.map((option) => ({
        optionId: option.optionId,
        label: tq(`attachTemplate.options.${option.optionId}.label`, {
          project: question.projectName,
        }),
        description: tq(`attachTemplate.options.${option.optionId}.description`),
      })),
    [question, tq],
  );
  const initial = options.findIndex((option) => option.optionId === question.defaultOptionId);
  const [pick, setPick] = useState(initial);
  const answered = answer !== null;
  const chosen = answered
    ? options.findIndex((option) => option.optionId === answer.optionId)
    : pick;

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
        box.current?.querySelectorAll<HTMLElement>('[role=radio]')[index]?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [answered, options]);

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
        {tq(`${question.questionId}.title`, { project: question.projectName })}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{tq(`${question.questionId}.note`)}</p>
      <div role="radiogroup" aria-labelledby={titleId} className="mt-2.5 flex flex-col gap-1.5">
        {options.map((option, index) => {
          const checked = chosen === index;
          return (
            <button
              key={option.optionId}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={answered}
              onClick={() => setPick(index)}
              onDoubleClick={() => confirm(index)}
              className={cn(
                'grid grid-cols-[auto_1fr] items-center gap-x-2.5 rounded-xl px-2.5 py-2 text-left outline-none',
                'ring-1 ring-border transition-[box-shadow,background-color] duration-100 motion-reduce:transition-none',
                'enabled:hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring',
                'aria-checked:bg-muted/50 aria-checked:ring-[1.5px] aria-checked:ring-foreground',
              )}
            >
              <kbd
                aria-hidden
                className={cn(
                  'row-span-2 grid size-5 place-items-center rounded-md font-mono text-[0.6875rem] text-muted-foreground ring-1 ring-border',
                  checked && 'bg-foreground text-background ring-0',
                )}
              >
                {index + 1}
              </kbd>
              <span className="col-start-2 text-[0.8125rem] font-medium text-foreground">
                {option.label}
              </span>
              <span className="col-start-2 text-xs text-muted-foreground">
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
            {t('answer')}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Допущение агента: что он предположил вместо вопроса и кнопка, чтобы поменять. Сборка его не
 * ждёт; поменяли — колода пересоберётся, а карточка покажет новый выбор.
 */
export function AssumptionCard({
  threadId,
  message,
}: {
  threadId: string;
  message: Extract<ThreadMessage, { kind: 'assume' }>;
}) {
  const t = useTranslations('assistant.audience');
  const label = (option: AudienceOption) => t(`options.${option}.label`);
  const audience = label(message.audience);

  const change = (next: string) => {
    const option = AUDIENCE_OPTIONS.find((item) => item === next);
    if (!option || option === message.audience) return;
    deckConversations.reassume(
      threadId,
      message.id,
      option,
      t('said', { audience: label(option) }),
    );
  };

  return (
    <div className="flex items-start gap-3 rounded-xl px-3 py-2.5 ring-1 ring-border">
      <span
        aria-hidden
        className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"
      >
        <PeopleIcon size={14} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
          {t(message.changed ? 'titleChanged' : 'title')}
        </p>
        <p className="text-[0.8125rem]/relaxed text-foreground">
          {t(message.changed ? 'leadChanged' : 'lead', { audience })}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            aria-label={t('changeLabel')}
          >
            {t('change')}
            <ChevronDownIcon data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>{t('menuTitle')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={message.audience} onValueChange={change}>
            {AUDIENCE_OPTIONS.map((option) => (
              <DropdownMenuRadioItem key={option} value={option} className="items-start">
                <span className="flex flex-col gap-0.5">
                  <span>{label(option)}</span>
                  <span className="text-[0.6875rem] text-muted-foreground">
                    {t(`options.${option}.description`)}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
