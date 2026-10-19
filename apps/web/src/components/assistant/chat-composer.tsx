'use client';

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { AttachmentChip } from '@/components/composer/attachment-chip';
import { ModelMenu } from '@/components/composer/model-menu';
import {
  useSpeechConfigured,
  VoicePill,
  type DictationPhase,
} from '@/components/composer/voice-pill';
import { ComposerSourceMenu } from '@/components/composer/composer-source-menu';
import { useComposerSuggestions } from '@/components/composer/composer-suggestions';
import {
  PromptBox,
  PromptChips,
  PromptAlert,
  PromptField,
  PromptNote,
  PromptSubmit,
  PromptToolbar,
  usePromptBox,
} from '@/components/composer/prompt-box';
import { promptAction } from '@/components/composer/prompt-keys';
import { CHAT_MODES } from '@lct/contracts';
import { pendingQuestion } from '@/lib/chat-records';
import type { ChatView } from '@/lib/chat-store';
import {
  addComposerFiles,
  COMPOSER_FILE_ACCEPT,
  TEMPLATE_FILE_ACCEPT,
  templateTitle,
} from '@/lib/composer-templates';
import { chatContextOf, contextAttachments, createSlideRef, refKey } from '@/lib/slide-context';
import type { TemplateSummary } from '@/lib/library-source';
import { useEditorPrefs } from '@/components/editor/use-editor-prefs';
import { useAssistantDeck } from './deck-context';
import { ModeMenu, nextChatMode, useLastChatMode } from './mode-menu';
import { chatStore } from './session';
import { useSlideRefLabels } from './slide-ref-label';

/** Текст реплики, который вернули в поле кнопкой «Изменить». */
export interface EditRequest {
  readonly text: string;
  readonly key: number;
}

/**
 * Поле чата. Вопрос агента ждёт ответа — текст уходит ответом. Иначе это сообщение агенту в
 * режиме у поля: «Чат» только разговаривает, «План» показывает план, «Авто» собирает сразу.
 * Shift+Tab меняет режим по кругу. Пока агент отвечает, «Стоп» сохраняет следующий черновик.
 */
export function ChatComposer({
  chat,
  edit,
  above,
  fieldRef,
  compact = false,
  deckId,
  templates = [],
}: {
  chat: ChatView;
  /**
   * Колода редактора: поле берёт у неё контекст — закреплённые объекты и выделение — и отдаёт
   * его агенту снимком вместе с сообщением.
   */
  deckId?: string;
  templates?: readonly TemplateSummary[];
  /** Реплика, которую вернули в поле кнопкой «Изменить». */
  edit?: EditRequest | null;
  /** Что висит над полем: кнопка «К последнему». */
  above?: ReactNode;
  fieldRef?: RefObject<HTMLTextAreaElement | null>;
  compact?: boolean;
}) {
  const t = useTranslations('deckChat.input');
  const speech = useSpeechConfigured();
  const voice = useTranslations('composer.voice');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  // While dictating nothing is sent, and while the recording turns into text the field waits too.
  const [dictation, setDictation] = useState<DictationPhase>('idle');
  const picker = useRef<HTMLInputElement>(null);
  const rejectedId = useId();
  const ownField = useRef<HTMLTextAreaElement>(null);
  const field = fieldRef ?? ownField;
  const {
    text,
    files,
    templateFile,
    template,
    context: restoredContext,
    attachments: restoredAttachments,
  } = chat.draft;
  const patchDraft = (patch: Partial<ChatView['draft']>) =>
    chatStore.setDraft(chat.chatId, {
      ...(chatStore.get(chat.chatId)?.draft ?? chat.draft),
      ...patch,
    });
  const setText = (value: string) => patchDraft({ text: value });
  const setFiles = (value: readonly File[] | ((current: readonly File[]) => readonly File[])) =>
    patchDraft({ files: typeof value === 'function' ? value(files) : value });
  const setTemplateFile = (value: File | null) => patchDraft({ templateFile: value });
  const [rejected, setRejected] = useState<readonly string[]>([]);
  const [emptyTemplates, setEmptyTemplates] = useState<readonly string[]>([]);
  const [, rememberMode] = useLastChatMode();
  const { slideCount } = useEditorPrefs();
  const deck = useAssistantDeck();
  const { label } = useSlideRefLabels();
  const tc = useTranslations('assistant.context');
  const tm = useTranslations('deckChat.modes');

  // «Спросить ассистента» и Ctrl+L зовут фокус сюда. Поле могло смонтироваться уже после
  // просьбы — вкладка только открылась, — поэтому просьбу забирают, а не ловят.
  const focusRequest = deck?.focusRequest ?? 0;
  const takeFocus = deck?.takeFocus;
  useEffect(() => {
    if (takeFocus?.()) field.current?.focus();
  }, [focusRequest, takeFocus, field]);

  // «Изменить»: текст реплики — в поле, курсор — в конец, чтобы сразу дописать.
  useEffect(() => {
    if (!edit) return;
    setText(edit.text);
    const element = field.current;
    if (!element) return;
    element.focus();
    requestAnimationFrame(() => element.setSelectionRange(edit.text.length, edit.text.length));
  }, [edit, field]);

  const question = pendingQuestion(chat.messages);
  const running = chat.running;
  const hasInput =
    text.trim() !== '' ||
    (!question &&
      (files.length > 0 ||
        templateFile !== null ||
        Boolean(template) ||
        Boolean(restoredContext?.length) ||
        Boolean(restoredAttachments?.length)));
  // Агент задал вопрос — фокус на ленте, а не в поле: так работают цифры выбора.
  useEffect(() => {
    if (question) field.current?.blur();
  }, [question, field]);
  const action = promptAction({
    hasInput,
    running,
    blocked: running || chat.recovery !== null || dictation !== 'idle',
    stopWhileTyping: true,
    stopping: chat.activity === 'stopping',
  });
  const box = usePromptBox({ ready: hasInput && !running, busy: running });

  const setMode = (mode: ChatView['mode']) => {
    chatStore.setMode(chat.chatId, mode);
    rememberMode(mode);
  };
  const sources =
    deck && deckId
      ? deck.slides.flatMap((slide) => {
          const refs = [
            createSlideRef(deck.slides, slide.slideId, []),
            ...slide.elements
              .filter((element) => element.kind !== 'decor')
              .map((element) => createSlideRef(deck.slides, slide.slideId, [element.elementId])),
          ];
          return refs.flatMap((ref) =>
            ref
              ? [
                  {
                    key: refKey(ref),
                    name: label(ref.subject, ref.slideNumber),
                    choose: () => deck.pin(ref),
                  },
                ]
              : [],
          );
        })
      : [];
  const suggestions = useComposerSuggestions({
    text,
    field,
    onText: setText,
    disabled: Boolean(question),
    sources,
    commands: CHAT_MODES.map((mode) => ({
      key: mode,
      name: `/${mode}`,
      description: `${tm(`${mode}.name`)} — ${tm(`${mode}.description`)}`,
      choose: () => setMode(mode),
    })),
  });

  const send = () => {
    if (action.action === 'stop') {
      chatStore.cancel(chat.chatId);
      return;
    }
    if (!hasInput || running || chat.recovery || dictation !== 'idle') return;
    const message = text.trim();
    if (question && message) {
      chatStore.answer(chat.chatId, question.questionId, { optionLabels: [], text: message });
      setText('');
      return;
    }
    // Снимок объектов на момент отправки: закреплённое и призрак, без устаревшего.
    const context =
      deck && deckId
        ? contextAttachments(deck.slides, deck.ghost ? [...deck.refs, deck.ghost] : deck.refs).map(
            (attachment) =>
              chatContextOf(deckId, attachment, label(attachment.subject, attachment.slideNumber)),
          )
        : [];
    chatStore.send(chat.chatId, {
      text: message,
      files,
      templateFile,
      template,
      attachments: restoredAttachments,
      context: [...(restoredContext ?? []), ...context],
      slideCount,
    });
    deck?.sent();
    setRejected([]);
    setEmptyTemplates([]);
  };

  const addFiles = (added: readonly File[]) => {
    if (added.length === 0) return;
    const current = chatStore.get(chat.chatId)?.draft ?? chat.draft;
    const update = addComposerFiles(current, added);
    patchDraft({
      files: update.files,
      templateFile: update.templateFile,
      template: update.templateFile ? null : current.template,
    });
    setRejected(update.rejected);
    setEmptyTemplates(update.emptyTemplates);
    if (
      update.templateFile !== current.templateFile ||
      update.files.length !== current.files.length
    )
      box.aurora.kick();
  };

  return (
    <div className="relative w-full">
      {above}
      {suggestions.menu}
      <PromptBox
        box={box}
        busy={running}
        size={compact ? 'compact' : 'default'}
        onSubmit={send}
        onFiles={question ? undefined : addFiles}
        pageDrop
        dropLabel={t('dropHere')}
      >
        {deck && deckId && (deck.refs.length > 0 || deck.ghost) ? (
          <PromptChips label={tc('label')}>
            {deck.refs.map((ref) => (
              <AttachmentChip
                key={refKey(ref)}
                attachment={ref}
                onRemove={() => {
                  deck.unpin(refKey(ref));
                  field.current?.focus();
                }}
              />
            ))}
            {deck.ghost ? (
              <AttachmentChip
                key={`ghost-${refKey(deck.ghost)}`}
                attachment={deck.ghost}
                ghost
                onPin={() => {
                  if (deck.ghost) deck.pin(deck.ghost);
                  field.current?.focus();
                }}
                onRemove={() => {
                  deck.dismissGhost();
                  field.current?.focus();
                }}
              />
            ) : null}
          </PromptChips>
        ) : null}
        {templateFile ||
        template ||
        files.length > 0 ||
        restoredContext?.length ||
        restoredAttachments?.length ? (
          <PromptChips label={t('files')}>
            {templateFile ? (
              <AttachmentChip
                attachment={{ kind: 'template', name: templateFile.name, size: templateFile.size }}
                onRemove={() => setTemplateFile(null)}
              />
            ) : null}
            {template ? (
              <AttachmentChip
                attachment={{
                  kind: 'template',
                  name: templateTitle(template.name),
                  previewUrl:
                    templates.find((item) => item.templateId === template.templateId)
                      ?.previewDataUrl ?? undefined,
                }}
                onRemove={() => patchDraft({ template: null })}
              />
            ) : null}
            {restoredContext?.map((item) => (
              <AttachmentChip
                key={item.name}
                attachment={{ kind: 'context', name: item.name }}
                onRemove={() =>
                  patchDraft({ context: restoredContext.filter((other) => other !== item) })
                }
              />
            ))}
            {restoredAttachments?.map((item, index) => (
              <AttachmentChip
                key={`restored-${index}`}
                attachment={{
                  kind: item.kind === 'slides' ? 'context' : item.kind,
                  name: item.name,
                }}
                onRemove={() =>
                  patchDraft({ attachments: restoredAttachments.filter((_, at) => at !== index) })
                }
              />
            ))}
            {files.map((file, index) => (
              <AttachmentChip
                key={`${file.name}-${file.size}-${file.lastModified}`}
                attachment={{ kind: 'file', name: file.name, size: file.size }}
                onRemove={() => setFiles((current) => current.filter((_, at) => at !== index))}
              />
            ))}
          </PromptChips>
        ) : null}
        <PromptField
          value={text}
          {...suggestions.fieldProps}
          onSelect={suggestions.onSelect}
          submitOnEnter={!running && !chat.recovery && dictation === 'idle'}
          readOnly={dictation === 'transcribing'}
          onValueChange={suggestions.onValueChange}
          fieldRef={field}
          label={t('label')}
          describedBy={rejected.length || emptyTemplates.length ? rejectedId : undefined}
          placeholder={
            dictation === 'transcribing'
              ? voice('transcribing')
              : question
                ? t('placeholderAnswer')
                : running
                  ? t('placeholderRunning')
                  : t('placeholder')
          }
          onKeyDown={(event) => {
            suggestions.onKeyDown(event);
            if (event.defaultPrevented) return;
            if (event.key !== 'Tab' || !event.shiftKey) return;
            event.preventDefault();
            setMode(nextChatMode(chat.mode));
          }}
        />
        <PromptToolbar
          end={
            <>
              <ModelMenu
                value={chat.model}
                onChange={(model) => chatStore.setModel(chat.chatId, model)}
                compact={compact}
              />
              {speech ? (
                <VoicePill
                  draft={text}
                  compact={compact}
                  disabled={Boolean(question) || running}
                  onDraft={(next) => {
                    setVoiceError(null);
                    setText(next);
                  }}
                  onError={setVoiceError}
                  onPhase={setDictation}
                />
              ) : null}
              <PromptSubmit
                state={action}
                label={t('send')}
                stopLabel={t('stop')}
                stoppingLabel={t('stopping')}
                onStop={() => chatStore.cancel(chat.chatId)}
                blockedHint={dictation !== 'idle' ? voice('busy') : t('placeholderRunning')}
              />
            </>
          }
        >
          <ComposerSourceMenu
            compact={compact}
            disabled={Boolean(question)}
            groups={{ own: [], others: templates }}
            inProject={false}
            selectedId={templateFile ? null : (template?.templateId ?? null)}
            pendingFile={templateFile !== null}
            onSelectTemplate={(id) => {
              const item = templates.find((entry) => entry.templateId === id);
              if (item)
                patchDraft({
                  template: { templateId: id, name: item.fileName },
                  templateFile: null,
                });
              box.aurora.flash();
            }}
            onUploadTemplate={() => {
              if (picker.current) {
                picker.current.accept = TEMPLATE_FILE_ACCEPT;
                picker.current.click();
              }
            }}
            onFiles={() => {
              if (picker.current) {
                picker.current.accept = COMPOSER_FILE_ACCEPT;
                picker.current.click();
              }
            }}
            onContext={
              sources.length
                ? () => {
                    setText(text + (text && !/\s$/.test(text) ? ' ' : '') + '@');
                    requestAnimationFrame(() => {
                      field.current?.focus();
                      const end = field.current?.value.length ?? 0;
                      field.current?.setSelectionRange(end, end);
                    });
                  }
                : undefined
            }
          />
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
              event.currentTarget.value = '';
              event.currentTarget.accept = COMPOSER_FILE_ACCEPT;
            }}
          />
          <ModeMenu value={chat.mode} onChange={setMode} compact={compact} />
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
