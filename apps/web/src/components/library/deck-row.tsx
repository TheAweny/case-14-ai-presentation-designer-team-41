import Link from 'next/link';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import type { DesignSystem } from '@lct/contracts';
import { SlidePreview } from '@/components/library/slide-preview';
import { DeckActions, DeckTitle } from '@/components/library/deck-actions';
import { AuditBadge } from '@/components/library/deck-card';
import { deckOpenHref } from '@/lib/library-menu';
import type { DeckSummary } from '@/lib/library-source';
import { cn } from '@/lib/utils';

/**
 * Строка презентации для вида «списком»: маленькая обложка, название, число слайдов, время
 * правки и итог аудита. Вся строка — ссылка в редактор; «⋯» справа и правая кнопка открывают
 * меню презентации.
 *
 * Как и `DeckCard`, рендерится только на сервере: «2 часа назад» считается один раз, и
 * гидрации нечего сверять.
 */
export function DeckRow({ deck, designSystem }: { deck: DeckSummary; designSystem: DesignSystem }) {
  const t = useTranslations('home.deckCard');
  const format = useFormatter();
  const now = useNow();
  const edited = new Date(deck.updatedAt);

  return (
    <DeckActions deckId={deck.deckId} projectId={deck.projectId} title={deck.title} layout="row">
      <Link
        href={deckOpenHref(deck)}
        className={cn(
          // Справа место под «⋯»: кнопка не должна накрывать название и мету.
          'group/row flex min-w-0 items-center gap-3 py-2 pr-11 pl-2 outline-none sm:gap-4 sm:pr-12 sm:pl-3',
          'transition-colors duration-150 motion-reduce:transition-none',
          'hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        )}
      >
        {/* Обложку называет название рядом, текст слайда для чтения с экрана лишний. */}
        <div
          aria-hidden
          className="w-20 shrink-0 overflow-hidden rounded-sm bg-card ring-1 ring-border sm:w-24"
          style={{ aspectRatio: `${deck.cover.slideCx} / ${deck.cover.slideCy}` }}
        >
          <SlidePreview
            slide={deck.cover}
            profile={designSystem}
            previewUrl={deck.coverPreviewUrl}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
          <h3 className="min-w-0 truncate text-sm font-medium sm:flex-1">
            <DeckTitle>{deck.title}</DeckTitle>
          </h3>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:shrink-0 sm:flex-nowrap">
            <span className="tabular-nums">{t('slides', { count: deck.slideCount })}</span>
            <span aria-hidden>·</span>
            <time dateTime={edited.toISOString()}>
              {t('edited', { time: format.relativeTime(edited, now) })}
            </time>
            <AuditBadge findings={deck.auditFindings} />
          </p>
        </div>
      </Link>
    </DeckActions>
  );
}
