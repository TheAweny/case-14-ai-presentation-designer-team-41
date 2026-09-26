import type { ReactNode } from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { cn } from '@/lib/utils';

/** Поля страницы главного меню: одни на главной и на странице проекта. */
export function LibraryPage({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-6 sm:px-6 md:px-8 md:py-8">
      {children}
    </div>
  );
}

/** Секция страницы с заголовком: у заголовка есть id, секция им подписана. */
export function LibrarySection({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  /** Сколько элементов в секции; показывается рядом с заголовком. */
  count?: number;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="flex items-baseline gap-2 text-base font-semibold">
        {title}
        {count !== undefined && count > 0 ? (
          <span className="text-sm font-normal text-muted-foreground tabular-nums">{count}</span>
        ) : null}
      </h2>
      {children}
    </section>
  );
}

/**
 * Пункт списка, чей объект уже удалён и ждёт ответа сервера (`data-removed`), прячется
 * целиком: иначе в сетке осталась бы пустая ячейка.
 */
export const HIDE_REMOVED_ITEMS = '[&>li:has(>[data-removed])]:hidden';

/**
 * Сетка карточек: столько колонок, сколько влезает по 14rem. `min(100%, …)` не даёт одной
 * колонке распереть страницу на узком экране.
 */
export function CardGrid({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <ul
      className={cn(
        'grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-x-4 gap-y-5',
        HIDE_REMOVED_ITEMS,
        className,
      )}
    >
      {children}
    </ul>
  );
}

/** Пустая секция: что здесь будет и как это получить. */
export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: IconSvgElement;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
        <HugeiconsIcon icon={icon} size={20} strokeWidth={1.5} aria-hidden />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
      {action}
    </div>
  );
}
