'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CloudUploadIcon, SavedIcon, WarningIcon } from '@/components/ui/icons';
import type { SlideIr } from '@lct/contracts';
import type { Deck } from '@/lib/deck-source';
import {
  DRAFT_READ_TIMEOUT_MS,
  createDraft,
  deckFingerprint,
  sameSlides,
  shouldRestoreDraft,
} from '@/lib/deck-draft';
import { createAutosave, type SaveStatus } from '@/lib/draft-autosave';
import { browserDraftStore, createDraftStorage } from '@/lib/draft-storage';
import {
  createEditorSession,
  SnapshotConflictError,
  decideOpen,
} from '@/lib/editor-sync';
import { slideImageUrls } from '@/lib/asset-readiness';
import { uploadedMedia } from '@/lib/media-registry';
import { cn } from '@/lib/utils';
import { PageSplash } from '@/components/page-splash';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { keepCanvasFocus } from '@/components/editor/chrome-focus';
import type { EditorLayout } from '@/components/editor/editor-layout';
import { AssistantPanel } from '@/components/assistant/assistant-panel';
import { chatStore } from '@/components/assistant/session';
import type { TemplateSummary } from '@/lib/library-source';
import { EditorChatContext } from '@/components/editor/editor-chat';
import { EditorShell } from '@/components/editor/editor-shell';
import { SLIDE_PARAM, slideIndexFromParam } from '@/components/editor/slide-navigation';
import { lockTemplateDecor } from '@/components/editor/template-lock';
import { useEditorPrefs } from '@/components/editor/use-editor-prefs';
import { useEditorAssets } from '@/components/editor/use-editor-assets';
import { FontAvailabilityProvider } from '@/components/editor/font-availability-context';
import { templateFonts } from '@/components/editor/inspector/text-model';

/**
 * Редактор колоды. Правки сначала остаются в IndexedDB, а «сохранено» загорается только после
 * ответа сервера. Серверная редакция новее локальной копии не подменяется сама: человек
 * выбирает, что открыть. Журнал отмены и смена колоды живут в оболочке, как раньше.
 */
export function DeckEditor({
  deck,
  media,
  layout,
  present = false,
  templates = [],
}: {
  deck: Deck;
  media?: Readonly<Record<string, string>>;
  layout?: EditorLayout;
  /** Открыть колоду сразу в показе с первого слайда: так просит пункт «Начать показ» в меню. */
  present?: boolean;
  /** Шаблоны библиотеки: для плана в чате колоды. */
  templates?: readonly TemplateSummary[];
}) {
  // Чат, в котором собрана эта колода: его продолжает панель «Ассистент».
  const [chatId, setChatId] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    chatStore.forDeck(deck.deckId).then(
      (found) => {
        if (live) setChatId(found);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [deck.deckId]);
  const base = useMemo(() => deckFingerprint(deck.slides), [deck.slides]);
  // Блокировка шаблона — как в настройках при открытии; оболочка получает то же значение.
  const { lockTemplate: lockPref } = useEditorPrefs();
  const [lockTemplate] = useState(lockPref);
  // С этим оболочка открывает исходную колоду: такие слайды — «правок нет».
  const origin = useMemo(
    () => (lockTemplate ? lockTemplateDecor(deck.slides) : deck.slides),
    [deck.slides, lockTemplate],
  );
  const [opened, setOpened] = useState<{ slides: readonly SlideIr[]; generation: number }>({
    slides: deck.slides,
    generation: 0,
  });
  /** Локальная копия, которую человек ещё не принял и не отклонил. */
  const [choice, setChoice] = useState<
    { kind: 'legacy'; slides: readonly SlideIr[] } | { kind: 'choose'; local: readonly SlideIr[] } | null
  >(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [hasDraft, setHasDraft] = useState(false);
  const storage = useMemo(() => {
    const store = browserDraftStore();
    return store ? createDraftStorage(store) : null;
  }, []);
  const session = useMemo(() => createEditorSession(), []);
  // Пока черновик не прочитан, писать нельзя: исходная колода стёрла бы его.
  const loaded = useRef(false);
  const latest = useRef<readonly SlideIr[] | null>(null);
  /** Что лежит в хранилище сейчас; null — неизвестно, тогда пишем любую новую правку. */
  const persisted = useRef<readonly SlideIr[] | null>(null);

  const autosave = useMemo(
    () =>
      createAutosave<readonly SlideIr[]>({
        write: async (slides) => {
          const untouched =
            sameSlides(slides, origin) && session.state.ackedRevision === null && !session.state.conflict;
          // IndexedDB — страховка до ответа сервера. Исходную колоду стираем только когда
          // серверной редакции нет: иначе откат должен пережить обрыв и доехать повторной записью.
          if (storage) {
            if (untouched) await storage.clear(deck.deckId);
            else await storage.save(createDraft(deck.deckId, base, slides, Date.now()), uploadedMedia);
          }
          persisted.current = slides;
          setHasDraft(!sameSlides(slides, origin));
          if (untouched) return;
          if (
            session.state.ackedSlides &&
            sameSlides(slides, session.state.ackedSlides) &&
            !session.state.conflict
          ) {
            return;
          }
          await session.publish(deck.deckId, base, slides, uploadedMedia);
          if (storage && sameSlides(slides, origin)) {
            await storage.clear(deck.deckId);
            persisted.current = origin;
            setHasDraft(false);
          }
        },
        classifyError: (error) => (error instanceof SnapshotConflictError ? 'conflict' : 'error'),
        onStatus: setStatus,
      }),
    [base, deck.deckId, origin, session, storage],
  );
  useEffect(() => () => autosave.dispose(), [autosave]);

  /*
   * Оболочка открывается, когда черновик прочитан: иначе исходная колода мелькнула бы до
   * подмены, а подмена пришлась бы на жест человека (протяжку вставки, набор) и сорвала его.
   * Чтение — единицы миллисекунд, пока идёт — заставка. Если база не отвечает дольше
   * `DRAFT_READ_TIMEOUT_MS`, колода открывается как есть, а поздний черновик применяется,
   * только пока человек ничего не поправил (`shouldRestoreDraft`).
   */
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const finish = (stored: readonly SlideIr[] | null) => {
      loaded.current = true;
      persisted.current = stored;
      setReady(true);
      if (latest.current && !sameSlides(latest.current, origin)) {
        autosave.schedule(latest.current);
      }
    };
    const openSlides = (
      slides: readonly SlideIr[],
      next: { kind: 'legacy'; slides: readonly SlideIr[] } | { kind: 'choose'; local: readonly SlideIr[] } | null,
    ) => {
      if (latest.current && !sameSlides(latest.current, origin)) {
        finish(null);
        return;
      }
      setOpened((current) => ({ slides, generation: current.generation + 1 }));
      setChoice(next);
      setHasDraft(!sameSlides(slides, origin));
      loaded.current = true;
      persisted.current = slides;
      setReady(true);
    };
    const timer = window.setTimeout(() => {
      if (!cancelled) setReady(true);
    }, DRAFT_READ_TIMEOUT_MS);
    void (async () => {
      const server = await session.load(deck.deckId);
      if (cancelled) return;
      if (server && server !== 'unavailable') {
        await session.restoreMedia(deck.deckId, server.media, uploadedMedia).catch(() => undefined);
      }
      if (cancelled) return;
      const draft = storage ? await storage.load(deck.deckId, base, uploadedMedia).catch(() => null) : null;
      if (cancelled) return;
      window.clearTimeout(timer);
      if (server === 'unavailable') {
        if (draft && shouldRestoreDraft(draft, origin, latest.current)) {
          openSlides(draft.slides, { kind: 'legacy', slides: draft.slides });
          return;
        }
        finish(draft ? draft.slides : origin);
        return;
      }
      const decision = decideOpen({
        originBase: base,
        originSlides: origin,
        server: server && { revision: server.revision, base: server.base, slides: server.slides },
        local: draft && { base: draft.base, slides: draft.slides },
      });
      if (decision.kind === 'server') openSlides(decision.slides, null);
      else if (decision.kind === 'legacy') openSlides(decision.slides, { kind: 'legacy', slides: decision.slides });
      else if (decision.kind === 'choose') openSlides(decision.serverSlides, { kind: 'choose', local: decision.localSlides });
      else finish(origin);
    })().catch(() => {
      if (!cancelled) finish(null);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [autosave, base, deck.deckId, origin, session, storage]);

  const onSlidesChange = useCallback(
    (slides: readonly SlideIr[]) => {
      latest.current = slides;
      if (!loaded.current) return;
      // Оболочка сообщает и сами открытые слайды, при каждом открытии: это не правка, писать
      // нечего, и браузер не должен переспрашивать об уходе. Пока запись ждёт, сообщение
      // заменяет её — отмена до записи должна дойти до черновика.
      const kept = persisted.current;
      if (kept && !autosave.busy() && sameSlides(slides, kept)) return;
      // Плашка про восстановленное уходит с первой новой правкой: отказ от черновика дальше
      // стёр бы и её.
      setChoice((shown) => {
        if (shown?.kind === 'legacy' && !sameSlides(slides, shown.slides)) return null;
        if (shown?.kind === 'choose') return null;
        return shown;
      });
      autosave.schedule(slides);
    },
    [autosave],
  );

  /** Отказ от черновика: исходная колода, а черновик стирается сразу же. */
  const discard = useCallback(() => {
    setChoice(null);
    setOpened((current) => ({ slides: deck.slides, generation: current.generation + 1 }));
    autosave.schedule(origin);
    void autosave.flush();
  }, [autosave, deck.slides, origin]);

  const publishLegacy = useCallback(() => {
    setChoice(null);
    autosave.schedule(latest.current ?? origin);
    void autosave.flush();
  }, [autosave, origin]);

  const applyLocal = useCallback(
    (localSlides: readonly SlideIr[]) => {
      setChoice(null);
      persisted.current = null;
      latest.current = localSlides;
      setOpened((current) => ({ slides: localSlides, generation: current.generation + 1 }));
      // expectedRevision уже равен серверной редакции: её прочитали при открытии.
      autosave.schedule(localSlides);
      void autosave.flush();
    },
    [autosave],
  );

  const keepServer = useCallback(() => {
    setChoice(null);
    const slides = session.state.ackedSlides ?? origin;
    persisted.current = slides;
    if (!storage) return;
    if (sameSlides(slides, origin)) void storage.clear(deck.deckId);
    else void storage.save(createDraft(deck.deckId, base, slides, Date.now()), uploadedMedia);
  }, [base, deck.deckId, origin, session, storage]);

  const reloadConflict = useCallback(() => {
    const server = session.acceptServer();
    if (!server) return;
    latest.current = server.slides;
    persisted.current = server.slides;
    setHasDraft(!sameSlides(server.slides, origin));
    setStatus('saved');
    setOpened((current) => ({ slides: server.slides, generation: current.generation + 1 }));
    if (storage) {
      if (sameSlides(server.slides, origin)) void storage.clear(deck.deckId);
      else void storage.save(createDraft(deck.deckId, base, server.slides, Date.now()), uploadedMedia);
    }
    // Очередь конфликта держит отвергнутую копию. Подменяем её серверными слайдами,
    // которые уже подтверждены, чтобы повтор не записал её поверх.
    autosave.schedule(server.slides);
    void autosave.flush();
  }, [autosave, base, deck.deckId, origin, session, storage]);

  const keepConflict = useCallback(() => {
    session.keepMine();
    autosave.schedule(latest.current ?? origin);
    void autosave.flush();
  }, [autosave, origin, session]);

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

  /*
   * Кадр готов, когда прочитан черновик, загружены шрифты шаблона и картинки открытого слайда.
   * До того редактор закрыт заставкой: оболочка монтируется под ней, как только известно, какая
   * колода откроется, и заставка уходит уже с готового кадра. Первую стадию — колоду с сервера —
   * показывает `loading.tsx` маршрута, эта заставка продолжает её.
   */
  const tSplash = useTranslations('splash');
  const tDraft = useTranslations('draft');
  /**
   * Дождаться записи и вернуть номер, который уйдёт в файл. Правки после этого вызова
   * номер не меняют: оболочка кладёт его в запрос один раз. Несохранённое и конфликт
   * экспорт не начинают.
   */
  const prepareExport = useCallback(async () => {
    const acknowledged = (slidesNow: readonly SlideIr[]) => {
      const { ackedRevision, ackedSlides } = session.state;
      if (ackedRevision !== null && ackedSlides && sameSlides(slidesNow, ackedSlides)) return ackedRevision;
      if (ackedRevision === null && sameSlides(slidesNow, origin)) return null;
      return undefined;
    };
    await autosave.flush();
    if (session.state.conflict) throw new Error(tDraft('exportConflict'));
    // Пока оболочка не сообщила жест, на экране открытая колода, а не исходная:
    // иначе экспорт успел бы записать исходник поверх уже принятой редакции.
    let slidesNow = latest.current ?? opened.slides;
    const readyRevision = acknowledged(slidesNow);
    if (readyRevision !== undefined) return readyRevision;
    autosave.schedule(slidesNow);
    await autosave.flush();
    if (session.state.conflict) throw new Error(tDraft('exportConflict'));
    slidesNow = latest.current ?? opened.slides;
    const again = acknowledged(slidesNow);
    if (again !== undefined) return again;
    throw new Error(tDraft('exportUnsaved'));
  }, [autosave, opened.slides, origin, session, tDraft]);
  const searchParams = useSearchParams();
  const [firstSlide] = useState(() =>
    slideIndexFromParam(deck.slides, searchParams.get(SLIDE_PARAM)),
  );
  // Все шрифты шаблона — и семейства темы, и шрифты ролей: по ним же проверяется, есть ли они.
  const fonts = useMemo(() => templateFonts(deck.designSystem), [deck.designSystem]);
  const images = useMemo(() => {
    const slide = deck.slides[firstSlide];
    return slide ? slideImageUrls(slide, media ?? {}) : [];
  }, [deck.slides, firstSlide, media]);
  const assets = useEditorAssets(fonts, images);
  const stages = [assets.fonts, assets.images, ready];
  const pending = !assets.fonts ? 'fonts' : !assets.images ? 'images' : !ready ? 'draft' : null;

  return (
    <>
      {ready ? (
        <FontAvailabilityProvider families={fonts} fontsReady={assets.fonts}>
          <EditorChatContext value={chatId}>
            <EditorShell
              key={opened.generation}
              deck={shown}
              media={media}
              layout={layout}
              lockTemplateOnOpen={lockTemplate}
              // Показ — только при первом открытии: подмена черновиком не должна начать его снова.
              presentOnOpen={present && opened.generation === 0}
              onSlidesChange={onSlidesChange}
              prepareExport={prepareExport}
              saveStatus={
                <SaveIndicator status={status} hasDraft={hasDraft} onRetry={() => void autosave.flush()} />
              }
              assistant={
                <AssistantPanel
                  chatId={chatId}
                  deckId={deck.deckId}
                  projectId={null}
                  templates={templates}
                />
              }
              openAssistant={chatId !== null}
            />
          </EditorChatContext>
          {status === 'conflict' ? (
            <DraftRestored
              message={tDraft('conflict')}
              confirm={tDraft('conflictKeep')}
              dismiss={tDraft('conflictReload')}
              onConfirm={keepConflict}
              onDismiss={reloadConflict}
            />
          ) : choice?.kind === 'legacy' ? (
            <DraftRestored
              message={tDraft('restored')}
              confirm={tDraft('discard')}
              dismiss={tDraft('dismiss')}
              onConfirm={discard}
              onDismiss={publishLegacy}
            />
          ) : choice?.kind === 'choose' ? (
            <DraftRestored
              message={tDraft('choose')}
              confirm={tDraft('chooseApply')}
              dismiss={tDraft('chooseServer')}
              onConfirm={() => applyLocal(choice.local)}
              onDismiss={keepServer}
            />
          ) : null}
        </FontAvailabilityProvider>
      ) : null}
      <PageSplash
        busy={pending !== null}
        label={tSplash(pending ?? 'ready')}
        // Колода с сервера уже пришла: это первая из четырёх стадий.
        progress={(1 + stages.filter(Boolean).length) / (1 + stages.length)}
      />
    </>
  );
}

/**
 * Значок состояния черновика в подвале списка слайдов. Пока правок нет, его нет: беречь
 * нечего. Подпись — в подсказке и для чтения с экрана.
 */
function SaveIndicator({
  status,
  hasDraft,
  onRetry,
}: {
  status: SaveStatus;
  hasDraft: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations('draft');
  const busy = status === 'pending' || status === 'saving';
  const attention = status === 'error' || status === 'conflict';
  if (!busy && !attention && !(status === 'saved' && hasDraft)) return null;
  const label =
    status === 'conflict' ? t('conflict') : status === 'error' ? t('error') : busy ? t('saving') : t('saved');
  const StatusIcon = attention ? WarningIcon : busy ? CloudUploadIcon : SavedIcon;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            role="status"
            aria-label={status === 'error' ? t('retry') : label}
            data-save-status={status}
            onClick={status === 'error' ? onRetry : undefined}
            className={cn(
              'grid size-7 shrink-0 place-items-center rounded-md outline-none',
              'focus-visible:ring-2 focus-visible:ring-ring/50',
              attention ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            <StatusIcon size={15} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Плашка выбора редакции. Внизу по центру, над нижней панелью телефона. */
function DraftRestored({
  message,
  confirm,
  dismiss,
  onConfirm,
  onDismiss,
}: {
  message: string;
  confirm: string;
  dismiss: string;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
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
      <span className="min-w-0 truncate">{message}</span>
      <button
        type="button"
        onMouseDown={keepCanvasFocus}
        onClick={onConfirm}
        className={cn(
          'shrink-0 rounded-md px-2 py-1.5 font-medium text-primary outline-none',
          'hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50',
          'max-md:min-h-11',
        )}
      >
        {confirm}
      </button>
      <button
        type="button"
        onMouseDown={keepCanvasFocus}
        onClick={onDismiss}
        className={cn(
          'shrink-0 rounded-md px-2 py-1.5 font-medium outline-none',
          'hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50',
          'max-md:min-h-11',
        )}
      >
        {dismiss}
      </button>
    </div>
  );
}
