'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { AttachmentChip } from '@/components/composer/attachment-chip';
import { ModelMenu } from '@/components/composer/model-menu';
import {
  PromptBox,
  PromptChips,
  PromptField,
  PromptNote,
  PromptSubmit,
  PromptToolbar,
  usePromptBox,
} from '@/components/composer/prompt-box';
import { promptAction } from '@/components/composer/prompt-keys';
import { Button } from '@/components/ui/button';
import { PlusIcon } from '@/components/ui/icons';
import { pendingQuestion } from '@/lib/chat-records';
import type { ChatView } from '@/lib/chat-store';
import { addComposerFiles, COMPOSER_FILE_ACCEPT } from '@/lib/composer-templates';
import { chatContextOf, contextAttachments, refKey } from '@/lib/slide-context';
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
 * Shift+Tab меняет режим по кругу. Пока агент отвечает и поле пустое, кнопка — «Стоп».
 */
export function ChatComposer({
  chat,
  edit,
  above,
  fieldRef,
  compact = false,
  deckId,
}: {
  chat: ChatView;
  /**
   * Колода редактора: поле берёт у неё контекст — закреплённые объекты и выделение — и отдаёт
   * его агенту снимком вместе с сообщением.
   */
  deckId?: string;
  /** Реплика, которую вернули в поле кнопкой «Изменить». */
  edit?: EditRequest | null;
  /** Что висит над полем: кнопка «К последнему». */
  above?: ReactNode;
  fieldRef?: RefObject<HTMLTextAreaElement | null>;
  compact?: boolean;
}) {
  const t = useTranslations('deckChat.input');
  const picker = useRef<HTMLInputElement>(null);
  const ownField = useRef<HTMLTextAreaElement>(null);
  const field = fieldRef ?? ownField;
  const [text, setText] = useState('');
  const [files, setFiles] = useState<readonly File[]>([]);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [rejected, setRejected] = useState<readonly string[]>([]);
  const [, rememberMode] = useLastChatMode();
  const { slideCount } = useEditorPrefs();
  const deck = useAssistantDeck();
  const { label } = useSlideRefLabels();
  const tc = useTranslations('assistant.context');

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
  const hasInput = text.trim() !== '' || (!question && (files.length > 0 || templateFile !== null));
  // Агент задал вопрос — фокус на ленте, а не в поле: так работают цифры выбора.
  useEffect(() => {
    if (question) field.current?.blur();
  }, [question, field]);
  const action = promptAction({ hasInput, running, blocked: running });
  const box = usePromptBox({ ready: hasInput && !running, busy: running });

  const setMode = (mode: ChatView['mode']) => {
    chatStore.setMode(chat.chatId, mode);
    rememberMode(mode);
  };

  const send = () => {
    if (action.action === 'stop') {
      chatStore.cancel(chat.chatId);
      return;
    }
    if (!hasInput || running) return;
    const message = text.trim();
    setText('');
    if (question && message) {
      chatStore.answer(chat.chatId, question.questionId, { optionLabels: [], text: message });
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
    chatStore.send(chat.chatId, { text: message, files, templateFile, context, slideCount });
    deck?.sent();
    setFiles([]);
    setTemplateFile(null);
    setRejected([]);
  };

  const addFiles = (added: readonly File[]) => {
    const update = addComposerFiles({ files, templateFile }, added);
    setFiles(update.files);
    setTemplateFile(update.templateFile);
    setRejected(update.rejected);
    box.aurora.kick();
  };

  return (
    <div className="relative w-full">
      {above}
      <PromptBox
        box={box}
        size={compact ? 'compact' : 'default'}
        onSubmit={send}
        onFiles={question ? undefined : addFiles}
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
        {templateFile || files.length > 0 ? (
          <PromptChips label={t('files')}>
            {templateFile ? (
              <AttachmentChip
                attachment={{ kind: 'template', name: templateFile.name, size: templateFile.size }}
                onRemove={() => setTemplateFile(null)}
              />
            ) : null}
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
          onValueChange={setText}
          fieldRef={field}
          label={t('label')}
          placeholder={
            question ? t('placeholderAnswer') : running ? t('placeholderRunning') : t('placeholder')
          }
          onKeyDown={(event) => {
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
              <PromptSubmit
                state={action}
                label={t('send')}
                stopLabel={t('stop')}
                blockedHint={t('placeholderRunning')}
              />
            </>
          }
        >
          <Button
            type="button"
            variant="ghost"
            size={compact ? 'icon' : 'icon-lg'}
            disabled={Boolean(question)}
            aria-label={t('attach')}
            onClick={() => picker.current?.click()}
            className="rounded-full text-muted-foreground"
          >
            <PlusIcon />
          </Button>
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
            }}
          />
          <ModeMenu value={chat.mode} onChange={setMode} compact={compact} />
        </PromptToolbar>
      </PromptBox>
      {rejected.length > 0 ? (
        <PromptNote>{t('rejected', { names: rejected.join(', ') })}</PromptNote>
      ) : null}
    </div>
  );
}
