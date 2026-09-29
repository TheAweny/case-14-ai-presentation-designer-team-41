'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ChatPart } from '@lct/contracts';
import { SpinnerIcon, SuccessIcon, WarningIcon } from '@/components/ui/icons';
import type { GeneratedVariant } from '@/lib/deck-generator';
import { recommendVariant, reviewDeck, type DeckResult } from '@/lib/variant-review';
import { BuildCard } from './build-card';
import { formatElapsed } from './elapsed';
import { ResultCard } from './result-card';
import { chatStore, followBuild, useRun } from './session';
import { loadVariantDeck } from './use-variant-deck';

type BuildPart = Extract<ChatPart, { type: 'build' }>;
type ResultPart = Extract<ChatPart, { type: 'result' }>;

/**
 * Сборка, которую запустил агент. Пока она идёт, вкладка досматривает её прогон, и карточка
 * показывает ход по этапам, как у сборки из поля. Прогона во вкладке нет (страницу открыли после
 * сборки) — остаётся строка итога.
 */
export function ChatBuild({ part, latest }: { part: BuildPart; latest: boolean }) {
  const t = useTranslations('deckChat.build');
  const run = useRun(part.runId);
  const { runId, status } = part;

  useEffect(() => {
    if (runId === null || status !== 'running') return;
    followBuild({ ...part, runId });
  }, [part, runId, status]);

  if (status === 'preparing') {
    return (
      <p role="status" className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
        <SpinnerIcon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        {t('preparing', { template: part.templateName })}
      </p>
    );
  }
  if (runId !== null && run) {
    return (
      <BuildCard runId={runId} latest={latest} unfinished={status === 'running'} retry={false} />
    );
  }
  const elapsed = part.finishedAt === null ? null : part.finishedAt - part.startedAt;
  const line =
    status === 'done'
      ? t('done', { time: formatElapsed(elapsed ?? 0) })
      : status === 'cancelled'
        ? t('cancelled')
        : status === 'failed'
          ? part.error
            ? t('failedWith', { reason: part.error })
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
  | { readonly status: 'ready'; readonly result: DeckResult };

/**
 * Итог сборки агента: варианты подгружаются из библиотеки, и их аудит считается теми же
 * проверками, что живой аудит редактора, — числа в итоге совпадают с тем, что покажет редактор.
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
  const key = part.variants.map((variant) => variant.deckId).join(',');

  useEffect(() => {
    let live = true;
    Promise.all(part.variants.map((variant) => loadVariantDeck(variant.deckId))).then(
      (decks) => {
        if (!live) return;
        const variants: GeneratedVariant[] = decks.flatMap(({ deck }, index) => {
          const cover = deck.slides[0];
          const variant = part.variants[index]?.variant;
          return cover && variant
            ? [
                {
                  variant,
                  deckId: deck.deckId,
                  title: deck.title,
                  slideCount: deck.slides.length,
                  cover,
                  coverPreviewUrl: deck.coverPreviewUrl,
                  designSystem: deck.designSystem,
                },
              ]
            : [];
        });
        const reviews = Object.fromEntries(
          decks.map(({ deck }) => [deck.deckId, reviewDeck(deck)]),
        );
        setLoaded({
          key,
          value: {
            status: 'ready',
            result: {
              runId: part.buildId,
              variants,
              reviews,
              recommended: variants.length ? recommendVariant(variants, reviews) : part.recommended,
              templateSubstituted: false,
              elapsedMs: part.elapsedMs,
            },
          },
        });
      },
      () => live && setLoaded({ key, value: { status: 'failed' } }),
    );
    return () => {
      live = false;
    };
  }, [key, part]);

  const value = loaded.key === key ? loaded.value : { status: 'loading' as const };
  if (value.status === 'loading') {
    return (
      <p role="status" className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
        <SpinnerIcon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        {t('title')}
      </p>
    );
  }
  if (value.status === 'failed' || value.result.variants.length === 0) {
    return <p className="text-[0.8125rem] text-destructive">{t('loadFailed')}</p>;
  }
  return (
    <ResultCard
      result={value.result}
      compact={compact}
      currentDeckId={currentDeckId}
      onChoose={(deckId) => chatStore.choose(chatId, deckId)}
    />
  );
}
