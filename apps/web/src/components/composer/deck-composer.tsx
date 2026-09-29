'use client';

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { usePathname, useRouter as useNextRouter } from 'next/navigation';
import { useRouter } from '@bprogress/next/app';
import { useTranslations } from 'next-intl';
import { deckConversations } from '@/components/assistant/session';
import { openSettings } from '@/components/settings/open-settings';
import { useWriterModels } from '@/components/settings/model-settings-store';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConnectIcon, PlusIcon, WarningIcon } from '@/components/ui/icons';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  COMPOSER_FILE_ACCEPT,
  TEMPLATE_FILE_ACCEPT,
  addComposerFiles,
  chosenTemplate,
  templateGroups,
} from '@/lib/composer-templates';
import { apiFetch } from '@/lib/api';
import { CONTENT_FILE_KINDS, TEMPLATE_EXTENSIONS, hasContent } from '@/lib/deck-generator';
import { chatHref } from '@/lib/library-menu';
import type { ProjectSummary, TemplateSummary } from '@/lib/library-source';
import type { ModelRef } from '@/lib/model-settings';
import { projectColorVar } from '@/lib/project-appearance';
import { effectiveModel, shortModelName, writerModelReady } from '@/lib/writer-models';
import { AttachmentChip } from './attachment-chip';
import { ComposerTemplateMenu } from './composer-template-menu';
import { ModelMenu } from './model-menu';
import {
  PromptBox,
  PromptChips,
  PromptField,
  PromptNote,
  PromptSubmit,
  PromptToolbar,
  usePromptBox,
} from './prompt-box';
import { promptAction } from './prompt-keys';
import { SlideCountMenu } from './slide-count-menu';
import { useEditorPrefs } from '@/components/editor/use-editor-prefs';

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
 * Стрелка (или Enter) начинает разговор с агентом (`deckConversations`) и открывает его страницу:
 * там агент собирает колоду и отдаёт три варианта. Поле собрано из частей `prompt-box.tsx` — тех
 * же, что в чате и в панели редактора, поэтому ведёт себя везде одинаково.
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
  const tAudience = useTranslations('assistant.audience.brief');
  const router = useRouter();
  const pathname = usePathname();
  const rejectedId = useId();
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
  const [model, setModel] = useState<ModelRef | null>(null);
  const models = useWriterModels();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [modelRequiredOpen, setModelRequiredOpen] = useState(false);

  const project = projects.find((item) => item.projectId === projectId) ?? null;
  const groups = templateGroups(templates, project);
  // Выбор в меню переживает чип: убрали новый файл — вернулся прежний шаблон.
  const selected = chosenTemplate(templates, project, pickedId);
  const hasTemplate = templateFile !== null || selected !== null;
  const ready = hasContent(text, files);
  // Пока настройки моделей не загрузились, неизвестно, есть ли чем писать: отправку придерживаем.
  const box = usePromptBox({ ready: ready && hasTemplate && models !== null, busy: sending });
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

  const addFiles = (added: readonly File[]) => {
    if (added.length === 0) return;
    const update = addComposerFiles({ files, templateFile }, added);
    setFiles(update.files);
    setTemplateFile(update.templateFile);
    setRejected(update.rejected);
    if (update.templateFile !== templateFile) box.aurora.flash();
    else box.aurora.kick();
  };

  const submit = async () => {
    if (!ready || sending || !hasTemplate) return;
    if (!writerModelReady(models)) {
      if (models !== null) setModelRequiredOpen(true);
      return;
    }
    setSending(true);
    for (const file of files) {
      const form = new FormData();
      form.set('file', file);
      const response = await apiFetch('/files/content', { method: 'POST', body: form });
      if (!response.ok) {
        setSending(false);
        setRejected((current) => [...current, file.name]);
        return;
      }
    }
    // Выбор показывают, только когда моделей несколько: подписывать в сообщении есть смысл тогда же.
    const chosen = models ? effectiveModel(models, model) : null;
    const threadId = deckConversations.start({
      request: {
        // Новый файл важнее выбора в меню: id шаблона разговор узнает, когда разберёт файл.
        templateId: templateFile ? null : (selected?.templateId ?? null),
        projectId,
        brief: text.trim(),
        files,
        slideCount,
        model: chosen,
      },
      templateFile,
      projectName: project?.name ?? null,
      meta: {
        templateName: templateFile?.name ?? selected?.fileName ?? '',
        slideCount,
        modelName: chosen && models && models.count > 1 ? shortModelName(chosen.modelId) : null,
      },
      returnHref: pathname,
      audienceLabels: {
        leadership: tAudience('leadership'),
        clients: tAudience('clients'),
        team: tAudience('team'),
      },
    });
    router.push(chatHref(threadId));
  };

  return (
    <div>
      <Dialog open={modelRequiredOpen} onOpenChange={setModelRequiredOpen}>
        <DialogContent closeLabel={t('modelRequired.close')} className="max-w-md">
          <DialogHeader className="pr-8">
            <span className="mb-1 grid size-10 place-items-center rounded-full bg-destructive/10 text-destructive">
              <WarningIcon size={20} aria-hidden />
            </span>
            <DialogTitle>{t('modelRequired.title')}</DialogTitle>
            <DialogDescription>{t('modelRequired.description')}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2 border-0 px-0 pb-0">
            <Button type="button" variant="ghost" onClick={() => setModelRequiredOpen(false)}>
              {t('modelRequired.later')}
            </Button>
            <Button
              type="button"
              autoFocus
              onClick={() => {
                setModelRequiredOpen(false);
                openSettings('models');
              }}
              className="ring-2 ring-primary/40 ring-offset-2 ring-offset-background"
            >
              <ConnectIcon data-icon="inline-start" />
              {t('modelRequired.connect')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PromptBox
        box={box}
        size="large"
        busy={sending}
        onSubmit={submit}
        onFiles={addFiles}
        dropLabel={t('dropHere')}
        style={glowStyle}
      >
        {templateFile || files.length > 0 ? (
          <PromptChips label={t('files')}>
            {/* Шаблон — первым: он меняет всю презентацию, а не добавляет материал. */}
            {templateFile ? (
              <AttachmentChip
                attachment={{ kind: 'template', name: templateFile.name, size: templateFile.size }}
                onRemove={() => {
                  setRejected([]);
                  setTemplateFile(null);
                  box.aurora.flash();
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
          </PromptChips>
        ) : null}
        <PromptField
          value={text}
          onValueChange={setText}
          label={t('label')}
          placeholder={t('placeholder')}
          fieldRef={field}
          describedBy={rejected.length > 0 ? rejectedId : undefined}
        />
        <PromptToolbar
          end={
            <>
              <ModelMenu value={model} onChange={setModel} />
              <PromptSubmit
                state={promptAction({
                  hasInput: ready,
                  sending,
                  blocked: !hasTemplate || models === null,
                })}
                label={t('submit')}
                blockedHint={hasTemplate ? t('modelRequired.loading') : t('needTemplate')}
              />
            </>
          }
        >
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
                <PlusIcon />
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
              box.aurora.flash();
            }}
            onUpload={() => templatePicker.current?.click()}
          />
          <SlideCountMenu value={slideCount} onChange={setSlideCount} />
        </PromptToolbar>
      </PromptBox>
      {rejected.length > 0 ? (
        <PromptNote id={rejectedId}>{t('rejected', { names: rejected.join(', ') })}</PromptNote>
      ) : null}
    </div>
  );
}
