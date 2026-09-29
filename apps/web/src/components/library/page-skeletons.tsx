import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { CardGrid, LibraryPage } from './page-parts';

/**
 * Серые заготовки страниц главного меню, пока сервер собирает данные: те же поля, сетки и
 * размеры, что у готовой страницы, поэтому, когда она приходит, ничего не прыгает. Сами блоки
 * скрыты от чтения с экрана — вместо них одна строка «Загружаем страницу…».
 */
export function PageSkeleton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy className="contents">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Шапка страницы: заголовок, подзаголовок и, если есть, кнопка справа. */
export function HeaderSkeleton({ action = false }: { action?: boolean }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      {action ? <Skeleton className="h-9 w-full shrink-0 sm:w-44" /> : null}
    </div>
  );
}

/** Поле генерации презентации. */
export function ComposerSkeleton() {
  return <Skeleton className="h-32 w-full rounded-xl" />;
}

/** Заголовок секции со счётчиком. */
export function SectionTitleSkeleton() {
  return <Skeleton className="h-5 w-32" />;
}

/** Карточки: презентаций и шаблонов — обложка и подпись, проектов — плашка. */
export function CardGridSkeleton({
  kind,
  count = 8,
}: {
  kind: 'deck' | 'template' | 'project';
  count?: number;
}) {
  return (
    <CardGrid className={kind === 'template' ? 'gap-3' : undefined}>
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="min-w-0">
          {kind === 'project' ? <ProjectCardSkeleton /> : <CoverCardSkeleton />}
        </li>
      ))}
    </CardGrid>
  );
}

function CoverCardSkeleton() {
  return (
    <div className="flex min-w-0 flex-col gap-2.5 p-1.5">
      <Skeleton className="aspect-video w-full" />
      <div className="flex flex-col gap-1.5 px-0.5">
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

function ProjectCardSkeleton() {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg p-3 ring-1 ring-border">
      <div className="flex min-w-0 items-center gap-3">
        <Skeleton className="size-12 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-2 w-full rounded-full" />
      <Skeleton className="h-3 w-1/3" />
    </div>
  );
}

/** Главная и любая страница меню без своей заготовки: шапка, поле и сетка обложек. */
export function LibraryPageSkeleton({ label }: { label: string }) {
  return (
    <PageSkeleton label={label}>
      <LibraryPage>
        <div className="flex flex-col gap-6">
          <HeaderSkeleton />
          <ComposerSkeleton />
        </div>
        <div className="flex flex-col gap-4">
          <SectionTitleSkeleton />
          <CardGridSkeleton kind="deck" />
        </div>
      </LibraryPage>
    </PageSkeleton>
  );
}

/** Профиль раскрытого шаблона: карточка профиля, шкала типографики и галерея слайдов. */
export function TemplatePanelSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-6 rounded-lg p-4 ring-1 ring-border md:p-5 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Skeleton className="h-5 w-32" />
          <div className="flex items-center gap-3">
            <Skeleton className="size-16 shrink-0" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <Skeleton className="h-3 w-20" />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,9rem),1fr))] gap-2">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-11" />
            ))}
          </div>
          <Skeleton className="mt-2 h-3 w-16" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <SectionTitleSkeleton />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
      <div className="flex flex-col gap-3">
        <SectionTitleSkeleton />
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,12rem),1fr))] gap-4">
          {Array.from({ length: 8 }, (_, index) => (
            <li key={index} className="flex flex-col gap-1.5">
              <Skeleton className="aspect-video w-full" />
              <Skeleton className="h-3 w-2/3" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Разговор с ассистентом: шапка, реплики по очереди и поле внизу. */
export function ChatSkeleton({ label }: { label: string }) {
  return (
    <PageSkeleton label={label}>
      <div className="flex min-h-dvh flex-col md:h-full md:min-h-0">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
          <Skeleton className="size-8" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 overflow-hidden px-4 py-6">
          <Skeleton className="h-10 w-2/3 self-end rounded-2xl" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Skeleton className="aspect-video" />
            <Skeleton className="aspect-video" />
            <Skeleton className="aspect-video" />
          </div>
          <Skeleton className="h-10 w-1/2 self-end rounded-2xl" />
        </div>
        <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4">
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </div>
    </PageSkeleton>
  );
}
