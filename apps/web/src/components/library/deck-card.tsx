import Link from 'next/link';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, CheckmarkCircle02Icon, SecurityCheckIcon } from '@hugeicons/core-free-icons';
import type { DesignSystem } from '@lct/contracts';
import { SlideView } from '@lct/slide-renderer';
import { auditStatusOf } from '@/components/library/audit-status';
import { DeckActions, DeckTitle } from '@/components/library/deck-actions';
import { deckHref } from '@/lib/library-menu';
import type { DeckSummary } from '@/lib/library-source';
import { cn } from '@/lib/utils';

/**
 * Карточка презентации в главном меню: обложка — первый слайд, нарисованный профилем её шаблона,
 * под ней название, проект, время правки, число слайдов и итог аудита. Вся карточка — ссылка
 * в редактор; правая кнопка и «⋯» в углу обложки открывают меню презентации (`DeckActions`).
 *
 * Компонент без `'use client'`: он рендерится только на сервере, поэтому «2 часа назад»
 * считается один раз и гидрации нечего сверять.
 */
export function DeckCard({
  deck,
  designSystem,
  projectName,
}: {
  deck: DeckSummary;
  /** Профиль шаблона проекта: им рисуется обложка. */
  designSystem: DesignSystem;
  /** Имя проекта в мете. На странице самого проекта не нужно — там оно в заголовке. */
  projectName?: string;
}) {
  const t = useTranslations('home.deckCard');
  const format = useFormatter();
  const now = useNow();
  const edited = new Date(deck.updatedAt);

  return (
    <DeckActions deckId={deck.deckId} projectId={deck.projectId} title={deck.title} layout="card">
      <Link
        href={deckHref(deck.deckId)}
        className={cn(
          'group/deck flex min-w-0 flex-col gap-2.5 rounded-lg p-1.5 outline-none',
          'transition-colors duration-150 motion-reduce:transition-none',
          'hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        {/*
         * Пропорции обложки задаёт сам слайд: рамка шаблона 4:3 останется 4:3. Фон под слайдом
         * — на случай, пока слайд не дорисован. Текст обложки скрыт от чтения с экрана: ссылку
         * называет заголовок карточки, а не весь первый слайд.
         */}
        <div
          aria-hidden
          className={cn(
            'overflow-hidden rounded-md bg-card ring-1 ring-border',
            'transition-[box-shadow] duration-150 motion-reduce:transition-none',
            'group-hover/deck:ring-foreground/30',
          )}
          style={{ aspectRatio: `${deck.cover.slideCx} / ${deck.cover.slideCy}` }}
        >
          <SlideView slide={deck.cover} profile={designSystem} thumbnail />
        </div>

        <div className="flex min-w-0 flex-col gap-1 px-0.5">
          <h3 className="line-clamp-2 text-sm leading-snug font-medium break-words">
            <DeckTitle>{deck.title}</DeckTitle>
          </h3>
          {/* Сначала что это (проект и объём), затем когда трогали и в каком состоянии. */}
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {projectName ? (
              <>
                <span className="min-w-0 truncate">{projectName}</span>
                <span aria-hidden>·</span>
              </>
            ) : null}
            <span className="shrink-0 tabular-nums">{t('slides', { count: deck.slideCount })}</span>
          </p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
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

/** Итог последнего аудита колоды: не запускали, чисто или сколько замечаний. */
export function AuditBadge({ findings }: { findings: number | null }) {
  const t = useTranslations('home.deckCard.audit');
  const status = auditStatusOf(findings);

  const look = {
    notRun: { icon: SecurityCheckIcon, className: 'text-muted-foreground ring-1 ring-border' },
    clean: { icon: CheckmarkCircle02Icon, className: 'bg-secondary text-secondary-foreground' },
    findings: { icon: Alert02Icon, className: 'bg-destructive/10 text-destructive' },
  }[status.kind];

  const label =
    status.kind === 'findings' ? t('findings', { count: status.count }) : t(status.kind);

  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[0.6875rem] font-medium',
        look.className,
      )}
    >
      <HugeiconsIcon icon={look.icon} size={12} strokeWidth={2} aria-hidden />
      {label}
    </span>
  );
}
