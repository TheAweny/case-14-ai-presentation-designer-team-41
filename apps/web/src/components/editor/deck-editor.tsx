'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Alert02Icon,
  Cancel01Icon,
  CloudSavingDone01Icon,
  CloudUploadIcon,
} from '@hugeicons/core-free-icons';
import type { SlideIr } from '@lct/contracts';
import type { Deck } from '@/lib/deck-source';
import { createDraft, deckFingerprint, sameSlides } from '@/lib/deck-draft';
import { createAutosave, type SaveStatus } from '@/lib/draft-autosave';
import { browserDraftStore, createDraftStorage } from '@/lib/draft-storage';
import { uploadedMedia } from '@/lib/media-registry';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { keepCanvasFocus } from '@/components/editor/chrome-focus';
import type { EditorLayout } from '@/components/editor/editor-layout';
import { EditorShell } from '@/components/editor/editor-shell';
import { lockTemplateDecor } from '@/components/editor/template-lock';

/**
 * Редактор колоды с черновиком в браузере. Пока API сохранения нет, правки после каждой паузы
 * уходят в IndexedDB и переживают перезагрузку; при открытии черновик этой колоды
 * возвращается, а плашка предлагает от него отказаться.
 *
 * Черновик подменяет колоду целиком: оболочка открывается заново со слайдами черновика, и
 * журнал правок начинается с них. Отказ от черновика так же открывает исходную колоду.
 */
export function DeckEditor({
  deck,
  media,
  layout,
}: {
  deck: Deck;
  media?: Readonly<Record<string, string>>;
  layout?: EditorLayout;
}) {
  const base = useMemo(() => deckFingerprint(deck.slides), [deck.slides]);
  // С этим оболочка открывает исходную колоду: такие слайды — «правок нет».
  const origin = useMemo(() => lockTemplateDecor(deck.slides), [deck.slides]);
  const [opened, setOpened] = useState<{ slides: readonly SlideIr[]; generation: number }>({
    slides: deck.slides,
    generation: 0,
  });
  /** Слайды восстановленного черновика, пока видна плашка. */
  const [restored, setRestored] = useState<readonly SlideIr[] | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [hasDraft, setHasDraft] = useState(false);
  const storage = useMemo(() => {
    const store = browserDraftStore();
    return store ? createDraftStorage(store) : null;
  }, []);
  // Пока черновик не прочитан, писать нельзя: исходная колода стёрла бы его.
  const loaded = useRef(false);
  const latest = useRef<readonly SlideIr[] | null>(null);

  const autosave = useMemo(
    () =>
      createAutosave<readonly SlideIr[]>({
        write: async (slides) => {
          if (!storage) throw new Error('IndexedDB is not available');
          if (sameSlides(slides, origin)) {
            await storage.clear(deck.deckId);
            setHasDraft(false);
            return;
          }
          await storage.save(createDraft(deck.deckId, base, slides, Date.now()), uploadedMedia);
          setHasDraft(true);
        },
        onStatus: setStatus,
      }),
    [base, deck.deckId, origin, storage],
  );
  useEffect(() => () => autosave.dispose(), [autosave]);

  useEffect(() => {
    let cancelled = false;
    const finish = () => {
      loaded.current = true;
      // Человек успел что-то поправить, пока черновик читался: его правка важнее.
      if (latest.current && !sameSlides(latest.current, origin)) {
        autosave.schedule(latest.current);
      }
    };
    if (!storage) {
      finish();
      return;
    }
    storage
      .load(deck.deckId, base, uploadedMedia)
      .then((draft) => {
        if (cancelled) return;
        const untouched = !latest.current || sameSlides(latest.current, origin);
        if (draft && untouched && !sameSlides(draft.slides, origin)) {
          setOpened((current) => ({ slides: draft.slides, generation: current.generation + 1 }));
          setRestored(draft.slides);
          setHasDraft(true);
          loaded.current = true;
          return;
        }
        finish();
      })
      .catch(() => {
        if (!cancelled) finish();
      });
    return () => {
      cancelled = true;
    };
  }, [autosave, base, deck.deckId, origin, storage]);

  const onSlidesChange = useCallback(
    (slides: readonly SlideIr[]) => {
      latest.current = slides;
      if (!loaded.current) return;
      // Плашка про восстановленное уходит с первой новой правкой: отказ от черновика дальше
      // стёр бы и её.
      setRestored((shown) => (shown && !sameSlides(slides, shown) ? null : shown));
      autosave.schedule(slides);
    },
    [autosave],
  );

  /** Отказ от черновика: исходная колода, а черновик стирается сразу же. */
  const discard = useCallback(() => {
    setRestored(null);
    setOpened((current) => ({ slides: deck.slides, generation: current.generation + 1 }));
    autosave.schedule(origin);
    void autosave.flush();
  }, [autosave, deck.slides, origin]);

  // Уйти со страницы, пока правка не записана, — потерять её: браузер переспросит. Запись при
  // этом продолжается, и если человек останется, она дойдёт.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!autosave.busy()) return;
      void autosave.flush();
      event.preventDefault();
      event.returnValue = '';
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void autosave.flush();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [autosave]);

  const shown = useMemo(() => ({ ...deck, slides: opened.slides }), [deck, opened.slides]);

  return (
    <>
      <EditorShell
        key={opened.generation}
        deck={shown}
        media={media}
        layout={layout}
        onSlidesChange={onSlidesChange}
        saveStatus={<SaveIndicator status={status} hasDraft={hasDraft} />}
      />
      {restored ? <DraftRestored onDiscard={discard} onDismiss={() => setRestored(null)} /> : null}
    </>
  );
}

/**
 * Значок состояния черновика в подвале списка слайдов. Пока правок нет, его нет: беречь
 * нечего. Подпись — в подсказке и для чтения с экрана.
 */
function SaveIndicator({ status, hasDraft }: { status: SaveStatus; hasDraft: boolean }) {
  const t = useTranslations('draft');
  const busy = status === 'pending' || status === 'saving';
  if (!busy && status !== 'error' && !(status === 'saved' && hasDraft)) return null;
  const label = status === 'error' ? t('error') : busy ? t('saving') : t('saved');
  const icon = status === 'error' ? Alert02Icon : busy ? CloudUploadIcon : CloudSavingDone01Icon;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="status"
            aria-label={label}
            data-save-status={status}
            tabIndex={0}
            className={cn(
              'grid size-7 shrink-0 place-items-center rounded-md outline-none',
              'focus-visible:ring-2 focus-visible:ring-ring/50',
              status === 'error' ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            <HugeiconsIcon icon={icon} size={15} strokeWidth={1.5} color="currentColor" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Плашка «правки восстановлены» с отказом от них. Внизу по центру, над нижней панелью телефона. */
function DraftRestored({ onDiscard, onDismiss }: { onDiscard: () => void; onDismiss: () => void }) {
  const t = useTranslations('draft');
  return (
    <div
      role="status"
      data-draft-restored=""
      className={cn(
        'fixed bottom-4 left-1/2 z-[3500] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center',
        'gap-1 rounded-xl bg-popover py-1 pr-1 pl-3 text-xs text-popover-foreground',
        'shadow-lg ring-1 shadow-black/20 ring-border',
        'animate-in fade-in-0 slide-in-from-bottom-2 duration-150 motion-reduce:animate-none',
        'max-md:bottom-[calc(4.5rem+env(safe-area-inset-bottom))]',
      )}
    >
      <span className="min-w-0 truncate">{t('restored')}</span>
      <button
        type="button"
        onMouseDown={keepCanvasFocus}
        onClick={onDiscard}
        className={cn(
          'shrink-0 rounded-md px-2 py-1.5 font-medium text-primary outline-none',
          'hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50',
          'max-md:min-h-11',
        )}
      >
        {t('discard')}
      </button>
      <button
        type="button"
        aria-label={t('dismiss')}
        onMouseDown={keepCanvasFocus}
        onClick={onDismiss}
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none',
          'hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
          'max-md:size-11',
        )}
      >
        <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} color="currentColor" />
      </button>
    </div>
  );
}
