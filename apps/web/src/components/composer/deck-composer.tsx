'use client';

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { usePathname, useRouter as useNextRouter } from 'next/navigation';
import { useRouter } from '@bprogress/next/app';
import { useTranslations } from 'next-intl';
import { ModeMenu, useLastChatMode } from '@/components/assistant/mode-menu';
import { chatStore } from '@/components/assistant/session';
import { useEditorPrefs } from '@/components/editor/use-editor-prefs';
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
import { ConnectIcon, WarningIcon } from '@/components/ui/icons';
import { CHAT_UI_MODES, nextChatMode, selectChatMode } from '@/lib/chat-modes';
import {
  COMPOSER_FILE_ACCEPT,
  TEMPLATE_FILE_ACCEPT,
  addComposerFiles,
  chosenTemplate,
  templateGroups,
  templateTitle,
} from '@/lib/composer-templates';
import { hasContent } from '@/lib/deck-generator';
import { chatHref } from '@/lib/library-menu';
import type { ProjectSummary, TemplateSummary } from '@/lib/library-source';
import type { ModelRef } from '@/lib/model-settings';
import { projectColorVar } from '@/lib/project-appearance';
import { writerModelReady } from '@/lib/writer-models';
import { AttachmentChip } from './attachment-chip';
import { ModelMenu } from './model-menu';
import { useSpeechConfigured, VoicePill, type DictationPhase } from './voice-pill';
import {
  PromptBox,
  PromptChips,
  PromptAlert,
  PromptField,
  PromptNote,
  PromptSubmit,
  PromptToolbar,
  usePromptBox,
} from './prompt-box';
import { promptAction } from './prompt-keys';
import { ComposerSourceMenu } from './composer-source-menu';
import { useComposerSuggestions } from './composer-suggestions';

/**
 * Поле генерации, как у ChatGPT и Claude: написать, о чём презентация, прикрепить материалы и
 * нажать стрелку — генерация начинается сразу, без мастера. Шаблон, число слайдов и файлы — рядом
 * с полем, у каждого есть разумное значение по умолчанию, поэтому хватает одного текста.
 *
 * Шаблон выбирают в меню «+» или кладут файлом: .pptx и .potx через перетаскивание или
 * «Загрузить шаблон…» становятся чипом с превью. Пока человек сам не выбрал шаблон, чипа нет.
 * Разбирает новый файл агент в разговоре.
 *
 * Стрелка (или Enter) начинает чат с агентом (`chatStore`) и открывает его страницу. Режим у
 * поля решает, что агент сделает с сообщением: «Чат» ответит, «План» покажет план колоды на
 * одобрение; переключатель «Авто» в «Плане» отключает утверждение. Шаблон не обязателен: без него агент спросит или обсудит. Поле собрано из частей `prompt-box.tsx` — тех
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
  const tm = useTranslations('deckChat.modes');
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
  const [emptyTemplates, setEmptyTemplates] = useState<readonly string[]>([]);
  const [mode, setMode] = useLastChatMode();
  // Число слайдов из настроек — пожелание агенту, а не жёсткое правило.
  const { slideCount } = useEditorPrefs();
  const [model, setModel] = useState<ModelRef | null>(null);
  const models = useWriterModels('assistant');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [modelRequiredOpen, setModelRequiredOpen] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  // While dictating nothing is sent, and while the recording turns into text the field waits too.
  const [dictation, setDictation] = useState<DictationPhase>('idle');
  const speech = useSpeechConfigured();

  const project = projects.find((item) => item.projectId === projectId) ?? null;
  const groups = templateGroups(templates, project);
  const selected = chosenTemplate(templates, project, pickedId);
  const ready = hasContent(text, files) || templateFile !== null;
  // Пока настройки моделей не загрузились, неизвестно, есть ли чем писать: отправку придерживаем.
  const box = usePromptBox({ ready: ready && models !== null, busy: sending });
  const suggestions = useComposerSuggestions({
    text,
    field,
    onText: setText,
    sources: [],
    commands: CHAT_UI_MODES.map((command) => ({
      key: command,
      name: `/${command}`,
      description: `${tm(`${command}.name`)} — ${tm(`${command}.description`)}`,
      choose: () => setMode(selectChatMode(command, mode)),
    })),
  });
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
    setEmptyTemplates(update.emptyTemplates);
    if (update.templateFile !== templateFile) box.aurora.flash();
    else if (update.files.length !== files.length) box.aurora.kick();
  };

  const submit = () => {
    if (!ready || sending || dictation !== 'idle') return;
    if (!writerModelReady(models, model)) {
      if (models !== null) setModelRequiredOpen(true);
      return;
    }
    setSending(true);
    // Выбор показывают, только когда моделей несколько: подписывать в сообщении есть смысл тогда же.
    const chosen = model;
    const chatId = crypto.randomUUID();
    chatStore.start(
      chatId,
      { projectId, mode, model: chosen },
      {
        text: text.trim(),
        files,
        slideCount,
        // Новый файл важнее выбора в меню.
        templateFile,
        template:
          templateFile || !selected
            ? null
            : { templateId: selected.templateId, name: selected.fileName },
      },
    );
    router.push(chatHref(chatId));
  };

  return (
    <div className="relative">
      {suggestions.menu}
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
        pageDrop={!sending}
        dropLabel={t('dropHere')}
        style={glowStyle}
      >
        {templateFile || selected || files.length > 0 ? (
          <PromptChips label={t('files')}>
            {templateFile ? (
              <AttachmentChip
                attachment={{ kind: 'template', name: templateFile.name, size: templateFile.size }}
                onRemove={() => {
                  setRejected([]);
                  setEmptyTemplates([]);
                  setTemplateFile(null);
                  box.aurora.flash();
                }}
              />
            ) : selected ? (
              <AttachmentChip
                attachment={{
                  kind: 'template',
                  name: templateTitle(selected.fileName),
                  previewUrl: selected.previewDataUrl ?? undefined,
                }}
                onRemove={() => {
                  setPickedId(null);
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
                  setEmptyTemplates([]);
                  setFiles((current) => current.filter((_, at) => at !== index));
                }}
              />
            ))}
          </PromptChips>
        ) : null}
        <PromptField
          value={text}
          {...suggestions.fieldProps}
          onSelect={suggestions.onSelect}
          onValueChange={suggestions.onValueChange}
          label={t('label')}
          placeholder={dictation === 'transcribing' ? t('voice.transcribing') : t('placeholder')}
          readOnly={dictation === 'transcribing'}
          fieldRef={field}
          describedBy={rejected.length > 0 || emptyTemplates.length > 0 ? rejectedId : undefined}
          onKeyDown={(event) => {
            suggestions.onKeyDown(event);
            if (event.defaultPrevented) return;
            if (event.key !== 'Tab' || !event.shiftKey) return;
            event.preventDefault();
            setMode(nextChatMode(mode));
          }}
        />
        <PromptToolbar
          end={
            <>
              <ModelMenu value={model} onChange={setModel} />
              {speech ? (
                <VoicePill
                  draft={text}
                  disabled={sending}
                  onDraft={(next) => {
                    setVoiceError(null);
                    setText(next);
                  }}
                  onError={setVoiceError}
                  onPhase={setDictation}
                />
              ) : null}
              <PromptSubmit
                state={promptAction({
                  hasInput: ready,
                  sending,
                  blocked: models === null || dictation !== 'idle',
                })}
                label={t('submit')}
                blockedHint={dictation !== 'idle' ? t('voice.busy') : t('modelRequired.loading')}
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
          <ComposerSourceMenu
            onFiles={() => picker.current?.click()}
            groups={groups}
            inProject={project !== null}
            selectedId={selected?.templateId ?? null}
            pendingFile={templateFile !== null}
            onSelectTemplate={(next) => {
              setPickedId(next);
              setTemplateFile(null);
              box.aurora.flash();
            }}
            onUploadTemplate={() => templatePicker.current?.click()}
          />
          <ModeMenu value={mode} onChange={setMode} />
        </PromptToolbar>
      </PromptBox>
      {emptyTemplates.length > 0 ? (
        <PromptAlert id={rejectedId}>{t('emptyTemplate')}</PromptAlert>
      ) : null}
      {rejected.some((name) => !emptyTemplates.includes(name)) ? (
        <PromptNote id={emptyTemplates.length > 0 ? undefined : rejectedId}>
          {t('rejected', {
            names: rejected.filter((name) => !emptyTemplates.includes(name)).join(', '),
          })}
        </PromptNote>
      ) : null}
      {voiceError ? <PromptNote>{voiceError}</PromptNote> : null}
    </div>
  );
}
