'use client';

import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { useRouter } from '@bprogress/next/app';
import { useTranslations } from 'next-intl';
import {
  DownloadIcon,
  EditIcon,
  ErrorIcon,
  GridIcon,
  PlayIcon,
  SuccessIcon,
  WarningIcon,
} from '@/components/ui/icons';
import type { LayoutVariant, SlideIr } from '@lct/contracts';
import { SlidePreview } from '@/components/library/slide-preview';
import { ExportDialog, type ExportOptions } from '@/components/editor/export-dialog';
import { SlideShow } from '@/components/editor/slide-show';
import { useDeckExport } from '@/components/editor/use-deck-export';
import { useEditorPrefs } from '@/components/editor/use-editor-prefs';
import { Button } from '@/components/ui/button';
import type { DeckResult, VariantReview } from '@/lib/assistant-threads';
import { datedFileName, safeFileName } from '@/lib/deck-export';
import { browserDraftStore, editedSlidesOf } from '@/lib/draft-storage';
import { createHttpExporter } from '@/lib/http-generation';
import { deckHref } from '@/lib/library-menu';
import { cn } from '@/lib/utils';
import { formatElapsed } from './elapsed';
import { assistantThreads } from './session';
import { SlidesDialog } from './slides-dialog';
import { mediaResolver, useVariantDeck, type VariantDeck } from './use-variant-deck';

/**
 * Итог сборки: три варианта вёрстки одного плана, аудит каждого и совет агента. Отсюда колоду
 * смотрят, показывают и скачивают — без редактора: готовый результат не требует правки руками.
 * Редактор — одно из действий, а не обязательный следующий шаг.
 *
 * В панели редактора (`compact`) карточка переключает колоду на другой вариант: смотреть,
 * показывать и скачивать там умеет сам редактор.
 */
export function ResultCard({
  threadId,
  result,
  compact = false,
  currentDeckId,
}: {
  threadId: string;
  result: DeckResult;
  compact?: boolean;
  /** Колода, открытая в редакторе сейчас: её вариант помечен, открыть его второй раз нельзя. */
  currentDeckId?: string;
}) {
  const t = useTranslations('assistant.result');
  const tv = useTranslations('assistant.variants');
  const router = useRouter();
  const titleId = useId();
  const opened = result.variants.find((item) => item.deckId === currentDeckId);
  const [picked, setPicked] = useState<LayoutVariant>(opened?.variant ?? result.recommended);
  const chosen =
    result.variants.find((item) => item.variant === picked) ?? result.variants[0] ?? null;
  const loaded = useVariantDeck(compact ? null : (chosen?.deckId ?? null));
  const variantDeck = loaded.status === 'ready' ? loaded.value : null;
  const [gallery, setGallery] = useState<number | null>(null);
  const [show, setShow] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  if (!chosen) return null;
  const recommendedName = tv(`${result.recommended}.name`);
  const recommendedReview = reviewOf(result, result.recommended);
  const reason = !recommendedReview
    ? ''
    : recommendedReview.errors === 0 && recommendedReview.warnings === 0
      ? t('reasonClean')
      : t('reasonFewest');
  const lead =
    result.elapsedMs === null
      ? t('lead', { variant: recommendedName })
      : t('leadTimed', { variant: recommendedName, time: formatElapsed(result.elapsedMs) });

  const open = (deckId: string) => {
    if (deckId === currentDeckId) return;
    assistantThreads.setDeck(threadId, deckId);
    router.push(deckHref(deckId));
  };

  const onOptionsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const at = result.variants.findIndex((item) => item.variant === picked);
    const next = result.variants[(at + step + result.variants.length) % result.variants.length];
    if (!next) return;
    setPicked(next.variant);
    event.currentTarget.querySelector<HTMLElement>(`[data-variant="${next.variant}"]`)?.focus();
  };

  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        'overflow-hidden rounded-2xl bg-card ring-1 ring-border',
        compact ? 'text-[0.8125rem]' : 'text-sm',
      )}
    >
      <header className={cn('flex flex-col gap-1', compact ? 'px-3 pt-3' : 'px-4 pt-4')}>
        <h3 id={titleId} className="font-medium text-foreground">
          {t('title')}
        </h3>
        <p className={cn('text-muted-foreground', compact ? 'text-xs' : 'text-[0.8125rem]')}>
          {reason ? `${lead} ${reason}` : lead}
        </p>
      </header>

      <div
        role="radiogroup"
        aria-labelledby={titleId}
        onKeyDown={onOptionsKeyDown}
        // Где тесно — в панели и на телефоне — строками: миниатюра слева, подписи справа. На
        // широкой странице — три колонки, чтобы варианты сравнивались рядом.
        className={cn(
          'grid grid-cols-1',
          compact ? 'gap-1.5 p-3' : 'gap-2 p-4 sm:grid-cols-3 sm:gap-3',
        )}
      >
        {result.variants.map((item) => {
          const checked = item.variant === picked;
          const review = result.reviews?.[item.deckId] ?? null;
          return (
            <button
              key={item.variant}
              type="button"
              role="radio"
              aria-checked={checked}
              data-variant={item.variant}
              tabIndex={checked ? 0 : -1}
              onClick={() => setPicked(item.variant)}
              onDoubleClick={() => open(item.deckId)}
              className={cn(
                'flex min-w-0 gap-2 rounded-xl p-1.5 text-left outline-none',
                compact
                  ? 'flex-row items-center'
                  : 'flex-row items-center sm:flex-col sm:items-stretch',
                'ring-1 ring-border transition-[box-shadow,background-color] duration-100 motion-reduce:transition-none',
                'hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring',
                'aria-checked:bg-muted/40 aria-checked:ring-[1.5px] aria-checked:ring-foreground',
              )}
            >
              <span
                className={cn(
                  'relative block shrink-0 overflow-hidden rounded-md ring-1 ring-border',
                  compact ? 'w-20' : 'w-24 sm:w-auto',
                )}
              >
                <SlidePreview
                  slide={item.cover}
                  profile={item.designSystem}
                  previewUrl={item.coverPreviewUrl}
                />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 px-0.5 pb-0.5">
                <span className="truncate font-medium text-foreground">
                  {tv(`${item.variant}.name`)}
                  {item.deckId === currentDeckId ? (
                    <span className="font-normal text-muted-foreground"> · {t('current')}</span>
                  ) : item.variant === result.recommended ? (
                    <span className="font-normal text-muted-foreground">
                      {' '}
                      · {t('recommendedInline')}
                    </span>
                  ) : null}
                </span>
                {compact ? null : (
                  <span className="truncate text-xs text-muted-foreground">
                    {tv(`${item.variant}.description`)}
                  </span>
                )}
                <AuditLine review={review} slideCount={compact ? null : item.slideCount} />
              </span>
            </button>
          );
        })}
      </div>

      <div
        className={cn(
          'flex flex-wrap items-center gap-2 border-t border-border',
          compact ? 'px-3 py-2.5' : 'px-4 py-3',
        )}
      >
        {compact ? (
          <Button
            type="button"
            disabled={chosen.deckId === currentDeckId}
            onClick={() => open(chosen.deckId)}
          >
            <EditIcon data-icon="inline-start" />
            {t('switchTo', { variant: tv(`${chosen.variant}.name`) })}
          </Button>
        ) : (
          <>
            {/*
             * Главное — забрать готовую колоду: итог не требует правки руками. Показ и просмотр —
             * рядом, редактор — тихо справа, как одно из действий, а не обязательный шаг.
             */}
            <Button
              type="button"
              size="lg"
              disabled={!variantDeck}
              onClick={() => setExportOpen(true)}
            >
              <DownloadIcon data-icon="inline-start" />
              {t('download')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={!variantDeck}
              onClick={() => setShow(true)}
            >
              <PlayIcon data-icon="inline-start" />
              {t('present')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              disabled={!variantDeck}
              onClick={() => setGallery(Date.now())}
            >
              <GridIcon data-icon="inline-start" />
              {t('browse')}
            </Button>
            {loaded.status === 'failed' ? (
              <span className="text-xs text-destructive">{t('loadFailed')}</span>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="ml-auto text-muted-foreground"
              onClick={() => open(chosen.deckId)}
            >
              <EditIcon data-icon="inline-start" />
              {t('edit')}
            </Button>
          </>
        )}
      </div>

      {result.templateSubstituted ? (
        <p
          className={cn(
            'border-t border-border text-[0.6875rem]/snug text-muted-foreground',
            compact ? 'px-3 py-2' : 'px-4 py-2.5',
          )}
        >
          {t('substituted')}
        </p>
      ) : null}

      {variantDeck ? (
        <VariantViews
          key={variantDeck.deck.deckId}
          variantDeck={variantDeck}
          variantName={tv(`${chosen.variant}.name`)}
          gallery={gallery}
          onGalleryClose={() => setGallery(null)}
          show={show}
          onShowExit={() => setShow(false)}
          exportOpen={exportOpen}
          onExportOpenChange={setExportOpen}
        />
      ) : null}
    </section>
  );
}

function reviewOf(result: DeckResult, variant: LayoutVariant): VariantReview | null {
  const deckId = result.variants.find((item) => item.variant === variant)?.deckId;
  return deckId ? (result.reviews?.[deckId] ?? null) : null;
}

/** Строка аудита варианта: чисто, ошибки, замечания. Без аудита — только число слайдов. */
function AuditLine({
  review,
  slideCount,
}: {
  review: VariantReview | null;
  /** null — не показывать. */
  slideCount: number | null;
}) {
  const t = useTranslations('assistant.result');
  const slides = slideCount === null ? null : t('slides', { count: slideCount });
  if (!review) {
    return slides ? <span className="text-xs text-muted-foreground">{slides}</span> : null;
  }
  const clean = review.errors === 0 && review.warnings === 0;
  const AuditIcon = review.errors > 0 ? ErrorIcon : review.warnings > 0 ? WarningIcon : SuccessIcon;
  const tone =
    review.errors > 0
      ? 'text-destructive'
      : review.warnings > 0
        ? 'text-(--project-yellow)'
        : 'text-muted-foreground';
  const audit = clean
    ? t('auditClean')
    : [
        review.errors > 0 ? t('errors', { count: review.errors }) : null,
        review.warnings > 0 ? t('warnings', { count: review.warnings }) : null,
      ]
        .filter(Boolean)
        .join(' · ');
  return (
    <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      <AuditIcon size={12} className={cn('shrink-0', tone)} aria-hidden />
      <span className="truncate">{slides ? `${audit} · ${slides}` : audit}</span>
    </span>
  );
}

/**
 * Просмотр, показ и экспорт выбранного варианта. Живут отдельно от карточки: у каждого варианта
 * свой экспорт, а смена варианта начинает их заново.
 */
function VariantViews({
  variantDeck,
  variantName,
  gallery,
  onGalleryClose,
  show,
  onShowExit,
  exportOpen,
  onExportOpenChange,
}: {
  variantDeck: VariantDeck;
  variantName: string;
  /** Ключ открытого просмотра слайдов; null — закрыт. */
  gallery: number | null;
  onGalleryClose: () => void;
  show: boolean;
  onShowExit: () => void;
  exportOpen: boolean;
  onExportOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('assistant.result');
  const tSlides = useTranslations('assistant.slides');
  const tEditor = useTranslations('editor');
  const prefs = useEditorPrefs();
  const [exporter] = useState(() => createHttpExporter());
  const job = useDeckExport(exporter);
  const { deck, media } = variantDeck;
  const resolveMedia = mediaResolver(media);
  // Правки редактора живут в черновике браузера: экспорт идёт по ним, а не по исходной колоде —
  // удаление и перестановка объектов доезжают до файла.
  const [editedSlides, setEditedSlides] = useState<readonly SlideIr[] | null>(null);
  useEffect(() => {
    let live = true;
    void editedSlidesOf(browserDraftStore(), deck.deckId, deck.slides)
      .then((slides) => {
        if (live) setEditedSlides(slides);
      })
      .catch(() => {
        if (live) setEditedSlides(null);
      });
    return () => {
      live = false;
    };
  }, [deck.deckId, deck.slides]);
  const slides = editedSlides ?? deck.slides;
  const labels = slides.map((_, at) => tSlides('slide', { number: at + 1 }));

  const startExport = (options: ExportOptions) => {
    const chosen = options.range === 'all' ? slides : slides.slice(0, 1);
    if (chosen.length === 0) return;
    job.start({
      deckId: deck.deckId,
      fileName: safeFileName(options.fileName, safeFileName(deck.title, tEditor('untitled'))),
      format: options.format,
      variant: deck.variant,
      slides: chosen,
      designSystem: deck.designSystem,
    });
  };

  return (
    <>
      {gallery !== null ? (
        <SlidesDialog
          key={gallery}
          open
          onOpenChange={(next) => {
            if (!next) onGalleryClose();
          }}
          title={deck.title}
          description={t('galleryNote', { variant: variantName, count: slides.length })}
          slides={slides}
          designSystem={deck.designSystem}
          resolveMedia={resolveMedia}
        />
      ) : null}
      {show ? (
        <SlideShow
          slides={slides}
          designSystem={deck.designSystem}
          labels={labels}
          start={0}
          resolveMedia={resolveMedia}
          onExit={onShowExit}
        />
      ) : null}
      <ExportDialog
        open={exportOpen}
        onOpenChange={onExportOpenChange}
        job={job}
        initialFormat={prefs.exportFormat}
        defaultFileName={
          prefs.exportName === 'title-date'
            ? datedFileName(safeFileName(deck.title, tEditor('untitled')), new Date())
            : safeFileName(deck.title, tEditor('untitled'))
        }
        slideCount={slides.length}
        currentIndex={0}
        variant={deck.variant}
        onStart={startExport}
      />
    </>
  );
}
