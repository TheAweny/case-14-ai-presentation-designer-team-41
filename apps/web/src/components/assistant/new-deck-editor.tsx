'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from '@bprogress/next/app';
import { useTranslations } from 'next-intl';
import { HugeiconsIcon } from '@hugeicons/react';
import { AiSparklesIcon, ArrowLeft01Icon } from '@hugeicons/core-free-icons';
import type { DesignSystem, SlideIr } from '@lct/contracts';
import { SlideView } from '@lct/slide-renderer';
import { Button } from '@/components/ui/button';
import type { AssistantThread } from '@/lib/assistant-threads';
import { deckHref } from '@/lib/library-menu';
import type { ProjectSummary } from '@/lib/library-source';
import { projectColorVar } from '@/lib/project-appearance';
import { cn } from '@/lib/utils';
import { deckSource } from '@/mocks/sources';
import { AssistantPanel } from './assistant-panel';
import { deckConversations, useHydrated, useRun, useThread } from './session';

interface ShownSlide {
  readonly slide: SlideIr;
  readonly designSystem: DesignSystem;
}

/** Первая строка брифа — рабочее название, пока агент не дал колоде своё. */
function workingTitle(thread: AssistantThread | undefined): string | null {
  const first = thread?.messages[0];
  if (first?.kind !== 'user') return null;
  return (
    first.text
      .split('\n')
      .find((line) => line.trim() !== '')
      ?.trim() ?? null
  );
}

/** Варианты вёрстки из вопроса агента, если он его задал: по ним открываются колоды вариантов. */
function variantOptions(thread: AssistantThread | undefined) {
  for (const message of [...(thread?.messages ?? [])].reverse()) {
    if (message.kind === 'ask' && message.question.questionId === 'variant') {
      return message.question.options;
    }
  }
  return [];
}

/**
 * Редактор новой колоды, пока агент её собирает. Раскладка та же, что у редактора: слайды слева,
 * холст, панель «Ассистент» справа — но править нечего, пока колода не собрана. Слайды
 * появляются по мере вёрстки; в вопросе о варианте наведённый вариант сразу показывается здесь.
 * Выбрали вариант — открывается настоящий редактор его колоды, и разговор продолжается там.
 */
export function NewDeckEditor({
  threadId,
  projects,
}: {
  threadId: string;
  projects: readonly ProjectSummary[];
}) {
  const t = useTranslations('newDeckEditor');
  const router = useRouter();
  const hydrated = useHydrated();
  const thread = useThread(threadId);
  const work = thread?.messages.findLast((message) => message.kind === 'work');
  const run = useRun(work?.kind === 'work' ? work.runId : null);
  const project = projects.find((item) => item.projectId === thread?.projectId);
  const [chosen, setChosen] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [variantSlides, setVariantSlides] = useState<Record<string, readonly ShownSlide[]>>({});
  const list = useRef<HTMLOListElement>(null);

  // Разговор выбрал вариант — открываем его колоду в редакторе, разговор переедет туда же.
  const deckId = thread?.deckId;
  useEffect(() => {
    if (deckId) router.replace(deckHref(deckId));
  }, [deckId, router]);

  // Слайды варианта под указателем: колоду варианта берём из источника один раз.
  const previewDeckId = variantOptions(thread).find(
    (option) => option.optionId === preview,
  )?.deckId;
  useEffect(() => {
    if (!preview || !previewDeckId || variantSlides[preview]) return;
    let live = true;
    void deckSource.getDeck(previewDeckId).then((deck) => {
      if (!live) return;
      setVariantSlides((current) => ({
        ...current,
        [preview]: deck.slides.map((slide) => ({ slide, designSystem: deck.designSystem })),
      }));
    });
    return () => {
      live = false;
    };
  }, [preview, previewDeckId, variantSlides]);

  const onPreviewVariant = useCallback((optionId: string | null) => setPreview(optionId), []);

  const streamed: readonly ShownSlide[] = run?.slides ?? [];
  const shown = (preview && variantSlides[preview]) || streamed;
  const layingOut = run?.progress.stages.find((stage) => stage.stage === 'laying-out');
  const total = Math.max(shown.length, run?.slides[0]?.total ?? layingOut?.total ?? 0);
  const running = run?.phase === 'running';
  // Пока идёт вёрстка, холст следует за последним свёрстанным слайдом, если человек не выбрал свой.
  const index = Math.min(chosen ?? (running ? shown.length - 1 : 0), Math.max(shown.length - 1, 0));
  const current = shown[index];

  useEffect(() => {
    if (chosen !== null || !running) return;
    list.current
      ?.querySelectorAll('li')
      [shown.length - 1]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [chosen, running, shown.length]);

  if (!hydrated) return <div className="h-dvh bg-background" />;
  if (!thread) {
    return (
      <main className="grid h-dvh place-items-center bg-background px-6">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <HugeiconsIcon
            icon={AiSparklesIcon}
            size={20}
            strokeWidth={1.5}
            className="text-muted-foreground"
          />
          <h1 className="text-base font-semibold">{t('notFound.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('notFound.body')}</p>
          <Button asChild variant="outline">
            <Link href="/">{t('notFound.home')}</Link>
          </Button>
        </div>
      </main>
    );
  }

  const title = workingTitle(thread);
  const back = deckConversations.returnHref(threadId) ?? '/';

  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)] bg-background md:grid-cols-[13rem_minmax(0,1fr)_22rem] md:grid-rows-1">
      <aside aria-label={t('slides')} className="hidden min-h-0 flex-col bg-sidebar md:flex">
        <ol ref={list} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 pl-2">
          {Array.from({ length: total }, (_, at) => {
            const item = shown[at];
            return (
              <li key={at} className="flex gap-1.5">
                <span className="w-4 shrink-0 pt-0.5 text-right text-[0.6875rem] text-muted-foreground tabular-nums">
                  {at + 1}
                </span>
                {item ? (
                  <button
                    type="button"
                    onClick={() => setChosen(at)}
                    aria-label={t('slide', { number: at + 1 })}
                    aria-current={at === index ? 'true' : undefined}
                    className={cn(
                      'assistant-reveal min-w-0 flex-1 overflow-hidden rounded-md outline-none ring-1 ring-border motion-reduce:animate-none',
                      'focus-visible:ring-2 focus-visible:ring-ring',
                      at === index && 'ring-2 ring-foreground',
                    )}
                  >
                    <SlideView slide={item.slide} profile={item.designSystem} thumbnail />
                  </button>
                ) : (
                  <span
                    aria-hidden
                    className="assistant-skeleton aspect-video min-w-0 flex-1 rounded-md bg-muted/50"
                  />
                )}
              </li>
            );
          })}
        </ol>
        <p className="shrink-0 border-t border-border p-2 text-right text-xs text-muted-foreground tabular-nums">
          {total > 0 ? t('counter', { number: index + 1, total }) : t('planning')}
        </p>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 px-3">
          <Button asChild variant="ghost" size="icon" aria-label={t('back')}>
            <Link href={back}>
              <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
            </Link>
          </Button>
          <h1
            className={cn(
              'min-w-0 truncate text-sm font-medium',
              running ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {title ?? t('untitled')}
          </h1>
          {preview ? (
            <span className="shrink-0 rounded-full px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-border">
              {t('preview')}
            </span>
          ) : null}
        </header>
        <div className="grid min-h-0 flex-1 place-items-center p-4 md:p-10">
          <div className="w-full max-w-4xl">
            {current ? (
              <div
                key={`${preview ?? 'run'}-${index}`}
                className="assistant-reveal overflow-hidden rounded-sm shadow-2xl shadow-black/40 motion-reduce:animate-none"
              >
                <SlideView
                  slide={current.slide}
                  profile={current.designSystem}
                  label={t('slide', { number: index + 1 })}
                />
              </div>
            ) : (
              <div className="assistant-skeleton grid aspect-video place-items-center rounded-sm bg-muted/40">
                <span className="relative text-sm text-muted-foreground">
                  {running ? t('planningCanvas') : t('waiting')}
                </span>
              </div>
            )}
          </div>
        </div>
      </main>

      <aside
        aria-label={t('assistant')}
        className="flex min-h-0 flex-col border-t border-border bg-sidebar md:border-t-0 md:border-l"
      >
        <div className="flex h-11 shrink-0 items-center border-b border-border px-3">
          <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
            {t('assistant')}
          </span>
        </div>
        <AssistantPanel
          thread={thread}
          glowColor={project ? projectColorVar(project.appearance.color) : undefined}
          onPreviewVariant={onPreviewVariant}
        />
      </aside>
    </div>
  );
}
