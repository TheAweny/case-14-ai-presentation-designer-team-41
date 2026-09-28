'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { CloseIcon, SuccessIcon, WarningIcon } from '@/components/ui/icons';
import { cn } from '@/lib/utils';

/** Сколько живёт уведомление. Об ошибке — дольше: её нужно успеть прочитать. */
const STATUS_MS = 2500;
const ALERT_MS = 7000;

type NoticeKind = 'status' | 'alert';

interface Notice {
  readonly id: number;
  readonly kind: NoticeKind;
  readonly text: string;
}

export interface LibraryNoticeApi {
  /** Короткое подтверждение: «Ссылка скопирована». Читается с экрана вежливо, без перебивания. */
  status(text: string): void;
  /** Что-то не вышло. Читается сразу. */
  alert(text: string): void;
}

const NoticeContext = createContext<LibraryNoticeApi | null>(null);

/**
 * Уведомления главного меню: одна строка внизу экрана. Меню к этому моменту уже закрыто, а
 * карточка могла исчезнуть, поэтому подтверждение и ошибка живут не у объекта, а здесь.
 *
 * Обе живые области есть в разметке всегда, меняется только их содержимое: так чтение с
 * экрана объявляет сообщение надёжно.
 */
export function LibraryNotices({ children }: { children: ReactNode }) {
  const t = useTranslations('libraryMenu.notices');
  const [notice, setNotice] = useState<Notice | null>(null);
  const counter = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setNotice(null);
  }, []);

  const show = useCallback((kind: NoticeKind, text: string) => {
    clearTimeout(timer.current);
    counter.current += 1;
    setNotice({ id: counter.current, kind, text });
    timer.current = setTimeout(() => setNotice(null), kind === 'alert' ? ALERT_MS : STATUS_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const api = useMemo<LibraryNoticeApi>(
    () => ({ status: (text) => show('status', text), alert: (text) => show('alert', text) }),
    [show],
  );

  const toast = (kind: NoticeKind) =>
    notice?.kind === kind ? (
      <p
        key={notice.id}
        className={cn(
          'pointer-events-auto flex max-w-md items-center gap-2 rounded-lg bg-popover py-2 pr-2 pl-3 text-sm',
          'text-popover-foreground shadow-lg ring-1 ring-border',
          'animate-in duration-150 fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none',
        )}
      >
        {kind === 'alert' ? (
          <WarningIcon size={16} aria-hidden className="shrink-0 text-destructive" />
        ) : (
          <SuccessIcon size={16} aria-hidden className="shrink-0 text-primary" />
        )}
        <span className="min-w-0 text-pretty">{notice.text}</span>
        <button
          type="button"
          aria-label={t('dismiss')}
          onClick={dismiss}
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground outline-none',
            'hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
          )}
        >
          <CloseIcon size={12} />
        </button>
      </p>
    ) : null;

  return (
    <NoticeContext value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex flex-col items-center gap-2 px-4">
        <div role="status" aria-atomic="true" className="flex justify-center">
          {toast('status')}
        </div>
        <div role="alert" aria-atomic="true" className="flex justify-center">
          {toast('alert')}
        </div>
      </div>
    </NoticeContext>
  );
}

/** Уведомления главного меню. Работает только внутри `LibraryNotices`. */
export function useLibraryNotice(): LibraryNoticeApi {
  const api = useContext(NoticeContext);
  if (!api) throw new Error('useLibraryNotice must be used inside LibraryNotices');
  return api;
}
