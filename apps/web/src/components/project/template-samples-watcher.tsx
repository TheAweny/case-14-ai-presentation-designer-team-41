'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { CircleIcon, ErrorIcon, SpinnerIcon, SuccessIcon } from '@/components/ui/icons';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Как часто спрашивать API, как далеко зашёл разбор. */
const POLL_MS = 1500;

/** Ответ `GET /generation/prepare/:templateId`: зеркало `TemplatePreparation` в API. */
interface Preparation {
  stage: 'profile' | 'index' | null;
  described: number;
  total: number;
  indexed: boolean;
  drawing: boolean;
  drawn: boolean;
}

type StepState = 'waiting' | 'active' | 'done' | 'failed';

/**
 * Разбор шаблона для галереи слайдов, с ходом по шагам. `index` — шаблон ещё не разобран:
 * движок читает файл, индексатор раскладывает слайды по видам (счётчик — сколько описано), и
 * параллельно движок рисует слайды. `draw` — разобран, но слайды ещё не нарисованы. Разбор, уже
 * идущий на сервере (страницу обновили, генерация на этом шаблоне), не запускается второй раз:
 * страница просто следит за ним. Закончился шаг, меняющий страницу, — она обновляется один раз.
 * Подготовка та же, что перед генерацией, поэтому генерация на этом шаблоне потом не ждёт разбора.
 */
export function TemplateSamplesWatcher({
  templateId,
  mode,
}: {
  templateId: string;
  mode: 'index' | 'draw';
}) {
  const t = useTranslations('projectPage.template.progress');
  const format = useFormatter();
  const router = useRouter();
  const [status, setStatus] = useState<Preparation | null>(null);
  const [failed, setFailed] = useState(false);
  const [drawingSince, setDrawingSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let started = false;
    /** Запрос подготовки, отправленный отсюда, закончился: дальше сервер сам ничего не начнёт. */
    let settled = false;
    /** API не отвечает, как идёт разбор: страница обновится, когда закончится запрос. */
    let blind = false;
    const url = `/generation/prepare/${encodeURIComponent(templateId)}`;

    const start = () => {
      started = true;
      void apiFetch('/generation/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ templateId, model: null }),
      })
        .then((response) => {
          if (!response.ok) setFailed(true);
        })
        .catch(() => setFailed(true))
        .finally(() => {
          settled = true;
          if (blind && !stopped) router.refresh();
        });
    };

    const poll = async () => {
      let next: Preparation | null = null;
      let unknown = false;
      try {
        const response = await apiFetch(url);
        unknown = response.status === 404;
        if (response.ok) next = (await response.json()) as Preparation;
      } catch {
        // Сеть мигнула: спросим на следующем круге.
      }
      if (stopped) return;
      // API не знает, как идёт разбор (старая версия): разбор всё равно запускается.
      if (unknown) {
        blind = true;
        if (!started) start();
        return;
      }
      if (next) {
        setStatus(next);
        const reached = mode === 'index' ? next.indexed : next.drawn;
        if (reached) {
          // Галерея на сервере уже другая: страница перерисуется, этот шаг ей больше не нужен.
          router.refresh();
          return;
        }
        const running = next.stage !== null || (mode === 'draw' && next.drawing);
        if (!running && settled) {
          // Всё закончилось, а нужного нет: индексатор или отрисовка не справились.
          setFailed(true);
          return;
        }
        if (!started && !running) start();
      }
      timer = setTimeout(() => void poll(), POLL_MS);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [templateId, mode, router]);

  // Сколько идёт отрисовка: у неё нет счётчика, движок отдаёт картинки разом.
  const drawing = status?.drawing ?? false;
  useEffect(() => {
    if (!drawing) return;
    setDrawingSince((since) => since ?? Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [drawing]);

  const indexFailed = mode === 'index' && failed;
  const drawFailed = mode === 'draw' && failed;

  const readState: StepState =
    status === null || status.stage === 'profile' ? (indexFailed ? 'failed' : 'active') : 'done';
  const indexState: StepState = indexFailed
    ? 'failed'
    : status?.stage === 'index'
      ? 'active'
      : status?.indexed
        ? 'done'
        : 'waiting';
  const drawState: StepState = drawFailed
    ? 'failed'
    : status?.drawn
      ? 'done'
      : status?.drawing || mode === 'draw'
        ? 'active'
        : 'waiting';

  const counted = status?.stage === 'index' && status.total > 0;
  const elapsed =
    drawState === 'active' && drawingSince !== null
      ? Math.max(0, Math.floor((now - drawingSince) / 1000))
      : null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t('label')}
      className="mt-2 flex max-w-xl flex-col gap-3 rounded-lg bg-card p-3.5 ring-1 ring-border"
    >
      <ol className="flex flex-col gap-2.5">
        {mode === 'index' ? (
          <>
            <Step state={readState} label={t('read')} />
            <Step
              state={indexState}
              label={t('index')}
              detail={
                counted
                  ? t('indexCount', { described: status.described, total: status.total })
                  : null
              }
              progress={
                indexState === 'active'
                  ? counted
                    ? status.described / status.total
                    : null
                  : undefined
              }
            />
          </>
        ) : null}
        <Step
          state={drawState}
          label={t('draw')}
          detail={
            elapsed === null
              ? null
              : format.number(Math.floor(elapsed / 60)) +
                ':' +
                String(elapsed % 60).padStart(2, '0')
          }
          progress={drawState === 'active' ? null : undefined}
        />
      </ol>
      <p
        className={cn(
          'text-xs',
          indexFailed || drawFailed ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {indexFailed
          ? t('indexFailed')
          : drawFailed
            ? t('drawFailed')
            : mode === 'index'
              ? t('indexHint')
              : t('drawHint')}
      </p>
    </div>
  );
}

const STEP_ICONS = {
  waiting: CircleIcon,
  active: SpinnerIcon,
  done: SuccessIcon,
  failed: ErrorIcon,
} as const;

/**
 * Шаг разбора: значок состояния, название, счётчик справа. `progress` — доля от 0 до 1 для
 * полосы, `null` — полоса без доли (сколько осталось, неизвестно), не задан — полосы нет.
 */
function Step({
  state,
  label,
  detail,
  progress,
}: {
  state: StepState;
  label: string;
  detail?: string | null;
  progress?: number | null;
}) {
  const StepIcon = STEP_ICONS[state];
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <StepIcon
          size={16}
          aria-hidden
          className={cn(
            'shrink-0',
            state === 'active' && 'animate-spin text-primary motion-reduce:animate-none',
            state === 'done' && 'text-muted-foreground',
            state === 'waiting' && 'text-muted-foreground/50',
            state === 'failed' && 'text-destructive',
          )}
        />
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            state === 'waiting' || state === 'done' ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {label}
        </span>
        {detail ? (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{detail}</span>
        ) : null}
      </div>
      {progress !== undefined ? (
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}
          className="ml-6 h-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              'h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none',
              progress === null && 'w-full animate-pulse bg-primary/50 motion-reduce:animate-none',
            )}
            style={progress === null ? undefined : { width: `${Math.max(2, progress * 100)}%` }}
          />
        </div>
      ) : null}
    </li>
  );
}
