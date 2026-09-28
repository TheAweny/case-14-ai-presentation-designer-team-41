'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { usePathname, useRouter as useNextRouter } from 'next/navigation';
import { useRouter } from '@bprogress/next/app';
import { useTranslations } from 'next-intl';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowUp02Icon, Attachment01Icon, Loading03Icon } from '@hugeicons/core-free-icons';
import { deckConversations, writerModels } from '@/components/assistant/session';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  COMPOSER_FILE_ACCEPT,
  TEMPLATE_FILE_ACCEPT,
  addComposerFiles,
  chosenTemplate,
  templateGroups,
} from '@/lib/composer-templates';
import { CONTENT_FILE_KINDS, TEMPLATE_EXTENSIONS, hasContent } from '@/lib/deck-generator';
import { newDeckHref } from '@/lib/library-menu';
import type { ProjectSummary, TemplateSummary } from '@/lib/library-source';
import { projectColorVar } from '@/lib/project-appearance';
import { cn } from '@/lib/utils';
import { apiBaseUrl } from '@/lib/api';
import { AttachmentChip } from './attachment-chip';
import { ComposerTemplateMenu } from './composer-template-menu';
import { ModelMenu } from './model-menu';
import { SlideCountMenu } from './slide-count-menu';
import { useAurora } from './use-aurora';
import { useEditorPrefs } from '@/components/editor/use-editor-prefs';

const noSubscribe = () => () => undefined;

/** На Mac сочетание — ⌘, у остальных — Ctrl. На сервере платформы не знаем и пишем Ctrl. */
function useIsMac(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => false,
  );
}

/** Расширения одного вида контента через запятую — для подсказки у скрепки. */
function extensionsOf(kind: string): string {
  return Object.entries(CONTENT_FILE_KINDS)
    .filter(([, value]) => value === kind)
    .map(([extension]) => extension)
    .join(', ');
}

/**
 * Поле генерации, как у ChatGPT и Claude: написать, о чём презентация, прикрепить материалы и
 * нажать стрелку — генерация начинается сразу, без мастера. Шаблон, число слайдов и файлы — рядом
 * с полем, у каждого есть разумное значение по умолчанию, поэтому хватает одного текста.
 *
 * Шаблон — из библиотеки (какой выбран сразу, решает `lib/composer-templates.ts`) или новый
 * файл: .pptx и .potx через скрепку, перетаскивание или «Загрузить шаблон…» становятся чипом
 * шаблона и заменяют выбор, пока чип не убрали. Разбирает новый файл агент в разговоре.
 *
 * Стрелка начинает разговор с агентом (`deckConversations`) и сразу открывает редактор новой
 * колоды: дальше разговор идёт в его панели «Ассистент», а слайды появляются по мере вёрстки.
 * Файлы едут вместе с разговором, а не через адрес или хранилище. Презентация появится там, где
 * стоит поле: в проекте страницы или, на главной, вне проектов. «Аврора» светится цветом этого
 * проекта, а на главной — нейтральным серым, как панель ассистента у колоды вне проектов.
 */
export function DeckComposer({
  templates,
  projects,
  projectId,
  focusRequested = false,
}: {
  /** Все шаблоны библиотеки. */
  templates: readonly TemplateSummary[];
  /** Проекты библиотеки: среди них — проект страницы с его шаблонами и цветом. */
  projects: readonly ProjectSummary[];
  /** Проект страницы, на которой стоит поле; null — главная, и презентация будет вне проектов. */
  projectId: string | null;
  /** Страницу открыли кнопкой «Новая презентация» (`?compose=1`): поле сразу в фокусе. */
  focusRequested?: boolean;
}) {
  const t = useTranslations('composer');
  const router = useRouter();
  const pathname = usePathname();
  const mac = useIsMac();
  const fieldId = useId();
  const rejectedId = useId();
  const blockedId = useId();
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const templatePicker = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<readonly File[]>([]);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [rejected, setRejected] = useState<readonly string[]>([]);
  // Число слайдов по умолчанию — из настроек; null — «Авто».
  const prefs = useEditorPrefs();
  const [slideCount, setSlideCount] = useState<number | null>(prefs.slideCount);
  const [modelId, setModelId] = useState<string | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sending, setSending] = useState(false);

  const project = projects.find((item) => item.projectId === projectId) ?? null;
  const groups = templateGroups(templates, project);
  // Выбор в меню переживает чип: убрали новый файл — вернулся прежний шаблон.
  const selected = chosenTemplate(templates, project, pickedId);
  const hasTemplate = templateFile !== null || selected !== null;
  const ready = hasContent(text, files);
  const aurora = useAurora(root, { ready: ready && hasTemplate, sending });
  const glowStyle = {
    '--aurora-color': projectColorVar(project?.appearance.color ?? 'gray'),
  } as CSSProperties;

  // «Новая презентация» ведёт сюда: фокус в поле, а параметр из адреса убираем тихо, без
  // полосы загрузки, — чтобы та же кнопка сработала и в следующий раз.
  const nextRouter = useNextRouter();
  useEffect(() => {
    if (!focusRequested) return;
    const element = field.current;
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    nextRouter.replace(pathname, { scroll: false });
  }, [focusRequested, nextRouter, pathname]);

  // Поле растёт по содержимому до своего max-height, дальше прокручивается.
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [text]);

  const addFiles = (added: readonly File[]) => {
    if (added.length === 0) return;
    const update = addComposerFiles({ files, templateFile }, added);
    setFiles(update.files);
    setTemplateFile(update.templateFile);
    setRejected(update.rejected);
    if (update.templateFile !== templateFile) aurora.flash();
    else aurora.kick();
  };

  const submit = async () => {
    if (!ready || sending || !hasTemplate) return;
    setSending(true);
    for (const file of files) {
      const form = new FormData();
      form.set('file', file);
      const response = await fetch(`${apiBaseUrl}/files/content`, { method: 'POST', body: form });
      if (!response.ok) {
        setSending(false);
        setRejected((current) => [...current, file.name]);
        return;
      }
    }
    const model = writerModels.find((item) => item.modelId === modelId) ?? null;
    const threadId = deckConversations.start({
      request: {
        // Новый файл важнее выбора в меню: id шаблона разговор узнает, когда разберёт файл.
        templateId: templateFile ? null : (selected?.templateId ?? null),
        projectId,
        brief: text.trim(),
        files,
        slideCount,
        modelId: model?.modelId ?? null,
      },
      templateFile,
      projectName: project?.name ?? null,
      meta: {
        templateName: templateFile?.name ?? selected?.fileName ?? '',
        slideCount,
        modelName: model?.name ?? null,
      },
      returnHref: pathname,
    });
    router.push(newDeckHref(threadId));
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  };

  // Перетаскивание файлов на поле: подсветка, пока файлы над ним, и прикрепление при отпускании.
  const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');
  const onDragOver = (event: DragEvent) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!dragging) setDragging(true);
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
  };
  const onDrop = (event: DragEvent) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <div
      ref={root}
      {...aurora.handlers}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="aurora rounded-xl"
      style={glowStyle}
    >
      <div aria-hidden className="aurora-halo" />
      <div aria-hidden className="aurora-ring" />
      <form
        onSubmit={onSubmit}
        aria-busy={sending}
        className="relative z-1 flex flex-col rounded-[inherit] bg-card ring-1 ring-border"
      >
        <label htmlFor={fieldId} className="sr-only">
          {t('label')}
        </label>
        <textarea
          ref={field}
          id={fieldId}
          value={text}
          rows={2}
          placeholder={t('placeholder')}
          aria-describedby={rejected.length > 0 ? rejectedId : undefined}
          onChange={(event) => {
            setText(event.currentTarget.value);
            aurora.kick();
          }}
          onKeyDown={onKeyDown}
          className={cn(
            'max-h-64 min-h-16 w-full resize-none overflow-y-auto bg-transparent px-4 pt-3.5 pb-1',
            'text-sm text-foreground outline-none placeholder:text-muted-foreground',
          )}
        />

        {templateFile || files.length > 0 ? (
          <ul aria-label={t('files')} className="flex flex-wrap gap-1.5 px-3 pt-1 pb-1.5">
            {/* Шаблон — первым: он меняет всю презентацию, а не добавляет материал. */}
            {templateFile ? (
              <AttachmentChip
                attachment={{ kind: 'template', name: templateFile.name, size: templateFile.size }}
                onRemove={() => {
                  setRejected([]);
                  setTemplateFile(null);
                  aurora.flash();
                }}
              />
            ) : null}
            {files.map((file, index) => (
              <AttachmentChip
                key={`${file.name}-${file.size}-${file.lastModified}`}
                attachment={{ kind: 'file', name: file.name, size: file.size }}
                onRemove={() => {
                  setRejected([]);
                  setFiles((current) => current.filter((_, at) => at !== index));
                }}
              />
            ))}
          </ul>
        ) : null}

        <TooltipProvider>
          <div className="flex flex-wrap items-center gap-1.5 px-2.5 pt-1 pb-2.5">
            <input
              ref={picker}
              type="file"
              multiple
              accept={COMPOSER_FILE_ACCEPT}
              tabIndex={-1}
              aria-hidden
              className="sr-only"
              onChange={(event) => {
                addFiles(Array.from(event.currentTarget.files ?? []));
                // Тот же файл можно выбрать снова, если его убрали.
                event.currentTarget.value = '';
              }}
            />
            <input
              ref={templatePicker}
              type="file"
              accept={TEMPLATE_FILE_ACCEPT}
              tabIndex={-1}
              aria-hidden
              className="sr-only"
              onChange={(event) => {
                addFiles(Array.from(event.currentTarget.files ?? []));
                event.currentTarget.value = '';
              }}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  className="rounded-full text-muted-foreground"
                  aria-label={t('attach')}
                  onClick={() => picker.current?.click()}
                >
                  <HugeiconsIcon icon={Attachment01Icon} strokeWidth={1.75} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {t('attachHint', {
                  text: extensionsOf('text'),
                  table: extensionsOf('table'),
                  template: TEMPLATE_EXTENSIONS.join(', '),
                })}
              </TooltipContent>
            </Tooltip>
            <ComposerTemplateMenu
              groups={groups}
              inProject={project !== null}
              selected={selected}
              pendingFile={templateFile}
              onSelect={(next) => {
                // Шаблон из библиотеки выбран осознанно: новый файл больше не нужен.
                setPickedId(next);
                setTemplateFile(null);
                aurora.flash();
              }}
              onUpload={() => templatePicker.current?.click()}
            />
            <SlideCountMenu value={slideCount} onChange={setSlideCount} />
            <span className="flex-1" />
            <ModelMenu models={writerModels} value={modelId} onChange={setModelId} />
            <Tooltip>
              {/*
               * Подсказка висит на обёртке: у недоступной кнопки нет событий указателя, а
               * объяснить, почему стрелка не нажимается, нужно как раз тогда.
               */}
              <TooltipTrigger asChild>
                <span className="inline-flex rounded-full">
                  <Button
                    type="submit"
                    size="icon-lg"
                    disabled={!ready || !hasTemplate || sending}
                    aria-label={sending ? t('sending') : t('submit')}
                    aria-describedby={hasTemplate ? undefined : blockedId}
                    aria-keyshortcuts={mac ? 'Meta+Enter' : 'Control+Enter'}
                    className={cn(
                      'rounded-full',
                      // Пока идёт переход, кнопка не блёкнет: это ответ на нажатие, а не запрет.
                      sending && 'disabled:opacity-100',
                    )}
                  >
                    <HugeiconsIcon
                      icon={sending ? Loading03Icon : ArrowUp02Icon}
                      strokeWidth={2}
                      className={cn(sending && 'animate-spin motion-reduce:animate-none')}
                    />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {hasTemplate ? (
                  <>
                    {t('submit')}
                    <span className="flex items-center gap-0.5">
                      <Kbd>{mac ? '⌘' : 'Ctrl'}</Kbd>
                      <Kbd>Enter</Kbd>
                    </span>
                  </>
                ) : (
                  t('needTemplate')
                )}
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>

        {hasTemplate ? null : (
          <p id={blockedId} className="sr-only">
            {t('needTemplate')}
          </p>
        )}
        {rejected.length > 0 ? (
          <p id={rejectedId} role="alert" className="px-4 pb-3 text-xs text-destructive">
            {t('rejected', { names: rejected.join(', ') })}
          </p>
        ) : null}
      </form>

      {dragging ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-3 grid place-items-center rounded-[inherit] border border-dashed border-foreground/40 bg-card/90 text-sm text-foreground"
        >
          {t('dropHere')}
        </div>
      ) : null}
    </div>
  );
}
