'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, ArrowUp01Icon } from '@hugeicons/core-free-icons';
import { cn } from '@/lib/utils';
import {
  NOTES_COMMIT_DELAY_MS,
  NOTES_PREFS_DEFAULT,
  NOTES_PREFS_KEY,
  clampNotesHeight,
  notesPreview,
  parseNotesPrefs,
  type NotesPrefs,
} from '@/components/editor/speaker-notes';

/** Шаг высоты стрелкой на ручке, в пикселях. */
const RESIZE_STEP = 16;

/** Пробелы вместо заметок колода не хранит: так их и сравниваем. */
function stored(text: string): string {
  return text.trim() === '' ? '' : text;
}

/**
 * Заметки докладчика под холстом, как в Google Slides и PowerPoint: свёрнутая строка с первой
 * фразой или поле во всю ширину, высоту которого тянут за верхний край.
 *
 * Набор идёт в журнал не по букве: после паузы, при уходе из поля и при смене слайда — одной
 * записью. Отмена колоды возвращает прежний текст в поле; внутри поля, пока оно в фокусе,
 * Ctrl+Z остаётся у самого поля.
 */
export function SpeakerNotesPanel({
  slideId,
  notes,
  onCommit,
  className,
}: {
  slideId: string;
  /** Заметки слайда из колоды. */
  notes: string | undefined;
  onCommit: (slideId: string, notes: string) => void;
  className?: string;
}) {
  const t = useTranslations('speakerNotes');
  const fieldId = useId();
  const [prefs, setPrefs] = useState<NotesPrefs>(NOTES_PREFS_DEFAULT);
  const [draft, setDraft] = useState(notes ?? '');
  const pending = useRef<{ slideId: string; text: string } | null>(null);
  const timer = useRef<number | null>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  // Раскладка — привычка этого браузера: читается после монтирования, сервер её не знает.
  useEffect(() => {
    try {
      setPrefs(parseNotesPrefs(window.localStorage.getItem(NOTES_PREFS_KEY)));
    } catch {
      // Хранилище закрыто: область просто начнётся свёрнутой.
    }
  }, []);
  const remember = useCallback((next: NotesPrefs) => {
    setPrefs(next);
    try {
      window.localStorage.setItem(NOTES_PREFS_KEY, JSON.stringify(next));
    } catch {
      // Не запомнится — не беда.
    }
  }, []);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const next = pending.current;
    pending.current = null;
    if (next) onCommitRef.current(next.slideId, next.text);
  }, []);

  // Другой слайд: недописанное уходит в журнал своего слайда, поле показывает заметки нового
  // (их ставит эффект ниже — набор к этому моменту уже записан).
  useEffect(() => flush, [slideId, flush]);

  // Заметки поменялись не отсюда (отмена, повтор, другой слайд): поле показывает их, если
  // набор не идёт.
  useEffect(() => {
    if (pending.current) return;
    setDraft((current) => (stored(current) === (notes ?? '') ? current : (notes ?? '')));
  }, [notes, slideId]);

  const change = (text: string) => {
    setDraft(text);
    pending.current = { slideId, text };
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, NOTES_COMMIT_DELAY_MS);
  };

  const onFieldKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.currentTarget.blur();
  };

  // Высота — за верхний край, как у панели заметок в PowerPoint.
  const drag = useRef<{ pointerId: number; y: number; height: number } | null>(null);
  const onResizeDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, y: event.clientY, height: prefs.height };
  };
  const onResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const height = clampNotesHeight(active.height - (event.clientY - active.y), window.innerHeight);
    setPrefs((current) => ({ ...current, height }));
  };
  const onResizeUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    remember(prefs);
  };
  const onResizeKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const delta =
      event.key === 'ArrowUp' ? RESIZE_STEP : event.key === 'ArrowDown' ? -RESIZE_STEP : 0;
    if (delta === 0) return;
    event.preventDefault();
    remember({
      ...prefs,
      height: clampNotesHeight(prefs.height + delta, window.innerHeight),
    });
  };

  const { open } = prefs;
  const preview = notesPreview(stored(draft));

  return (
    <section
      data-speaker-notes=""
      aria-label={t('label')}
      className={cn(
        'relative flex shrink-0 flex-col border-t border-border bg-background',
        className,
      )}
      style={open ? { height: prefs.height } : undefined}
    >
      {open ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('resize')}
          aria-valuenow={prefs.height}
          tabIndex={0}
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          onKeyDown={onResizeKey}
          className={cn(
            'absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize touch-none outline-none',
            'hover:bg-ring/30 focus-visible:bg-ring/50',
          )}
        />
      ) : null}
      <div className="flex h-8 shrink-0 items-center gap-2 px-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={fieldId}
          title={open ? t('hide') : t('show')}
          onClick={() => remember({ ...prefs, open: !open })}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-md px-1 text-xs font-medium text-muted-foreground outline-none',
            'hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <HugeiconsIcon
            icon={open ? ArrowDown01Icon : ArrowUp01Icon}
            size={14}
            strokeWidth={1.5}
            color="currentColor"
          />
          {t('label')}
        </button>
        {!open && preview ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground" data-notes-preview="">
            {preview}
          </span>
        ) : null}
      </div>
      {open ? (
        <textarea
          id={fieldId}
          aria-label={t('label')}
          placeholder={t('placeholder')}
          value={draft}
          spellCheck
          onChange={(event) => change(event.currentTarget.value)}
          onBlur={flush}
          onKeyDown={onFieldKeyDown}
          className={cn(
            'min-h-0 flex-1 resize-none bg-transparent px-4 pb-3 text-sm leading-relaxed text-foreground outline-none',
            'placeholder:text-muted-foreground',
          )}
        />
      ) : null}
    </section>
  );
}
