'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { ModelMenu } from '@/components/composer/model-menu';
import {
  PromptBox,
  PromptChips,
  PromptField,
  PromptSubmit,
  PromptToolbar,
  usePromptBox,
} from '@/components/composer/prompt-box';
import { promptAction } from '@/components/composer/prompt-keys';
import { AgentIcon } from '@/components/ui/icons';
import { AttachmentChip } from '@/components/composer/attachment-chip';
import type { AssistantThread } from '@/lib/assistant-threads';
import type { ModelRef } from '@/lib/model-settings';
import { contextAttachments, refKey } from '@/lib/slide-context';
import { useAssistantDeck } from './deck-context';
import { assistantThreads, deckConversations, generationRuns, useRun } from './session';
import { ResultCard } from './result-card';
import {
  AgentMessage,
  AskCard,
  AssumptionCard,
  ImportCard,
  TemplateCard,
  ThinkingLine,
  UserMessage,
  WorkCard,
} from './thread-messages';

/**
 * Панель «Ассистент» редактора: разговор, который собрал колоду, продолжается здесь — с ходом
 * сборки и итогом, из которого можно перейти на другой вариант вёрстки. Здесь же просят правки.
 *
 * Разговора может ещё не быть: колоду открыли из меню. Тогда первое сообщение его начинает и
 * привязывает к колоде.
 */
export function AssistantPanel({
  thread,
  deckId,
  glowColor,
}: {
  thread: AssistantThread | undefined;
  /** Колода редактора: к ней привяжется разговор, начатый в панели. */
  deckId?: string;
  /** Цвет свечения поля — цвет проекта; без него свечение нейтральное. */
  glowColor?: string;
}) {
  const t = useTranslations('assistant');
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const messages = thread?.messages ?? [];
  const latestRun = activeRunId(thread);
  // «Изменить» у реплики: текст возвращается в поле. `key` различает два нажатия на одну реплику.
  const [edit, setEdit] = useState<{ text: string; key: number } | null>(null);
  const onEdit = (text: string) => setEdit({ text, key: Date.now() });

  // Лента держится у низа, пока человек сам не прокрутил её вверх.
  useLayoutEffect(() => {
    const element = list.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  });

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      style={{ '--aurora-color': glowColor ?? 'var(--project-gray)' } as CSSProperties}
    >
      <div
        ref={list}
        role="log"
        aria-label={t('log')}
        aria-live="polite"
        onScroll={(event) => {
          const element = event.currentTarget;
          stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        }}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3.5 pt-4 pb-2"
      >
        {messages.length === 0 ? (
          <div className="m-auto flex max-w-56 flex-col items-center gap-2.5 text-center">
            <AgentIcon className="size-5 text-muted-foreground" aria-hidden />
            <p className="text-sm text-balance text-muted-foreground">{t('empty')}</p>
          </div>
        ) : (
          messages.map((message) => {
            return (
              <div
                key={message.id}
                className="assistant-rise flex flex-col gap-2 motion-reduce:animate-none"
              >
                {message.kind === 'user' ? (
                  <UserMessage message={message} onEdit={onEdit} />
                ) : message.kind === 'agent' ? (
                  <AgentMessage text={message.text} />
                ) : message.kind === 'work' ? (
                  <WorkCard runId={message.runId} latest={message.runId === latestRun} />
                ) : message.kind === 'import' ? (
                  <ImportCard importId={message.importId} />
                ) : message.kind === 'template' ? (
                  thread ? (
                    <TemplateCard template={message.template} threadId={thread.threadId} />
                  ) : null
                ) : !thread ? null : message.kind === 'assume' ? (
                  <AssumptionCard threadId={thread.threadId} message={message} />
                ) : message.kind === 'result' ? (
                  <ResultCard
                    threadId={thread.threadId}
                    result={message.result}
                    currentDeckId={deckId}
                    compact
                  />
                ) : (
                  <>
                    <AskCard threadId={thread.threadId} message={message} />
                    {message.answer ? (
                      <UserMessage
                        message={{
                          kind: 'user',
                          id: `${message.id}-answer`,
                          text: message.answer.text,
                          attachments: [],
                          meta: null,
                        }}
                      />
                    ) : null}
                  </>
                )}
              </div>
            );
          })
        )}
        {messages.at(-1)?.kind === 'user' ? <ThinkingLine /> : null}
      </div>
      <AssistantInput thread={thread} deckId={deckId} edit={edit} />
    </div>
  );
}

/** Прогон, который идёт в разговоре сейчас: кнопка отправки становится «Стоп». */
function activeRunId(thread: AssistantThread | undefined): string | null {
  const work = thread?.messages.findLast((message) => message.kind === 'work');
  return work?.kind === 'work' ? work.runId : null;
}

function AssistantInput({
  thread,
  deckId,
  edit,
}: {
  thread: AssistantThread | undefined;
  deckId?: string;
  /** Реплика, которую вернули в поле кнопкой «Изменить». */
  edit: { text: string; key: number } | null;
}) {
  const t = useTranslations('assistant.input');
  const tc = useTranslations('assistant.context');
  const deck = useAssistantDeck();
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  // Модель — у разговора, который собирает колоду; разговор, начатый в панели, колод не собирает.
  const threadModel = thread ? deckConversations.modelOf(thread.threadId) : undefined;
  const [model, setModel] = useState<ModelRef | null>(threadModel ?? null);
  const run = useRun(activeRunId(thread));
  const running = run?.phase === 'running';
  const pending = thread ? assistantThreads.pendingQuestion(thread.threadId) : undefined;
  const hasInput = text.trim() !== '';
  const action = promptAction({ hasInput, running });
  const box = usePromptBox({ ready: hasInput, busy: running });

  // «Изменить»: текст реплики — в поле, курсор — в конец, чтобы сразу дописать.
  useEffect(() => {
    if (!edit) return;
    setText(edit.text);
    const element = field.current;
    if (!element) return;
    element.focus();
    requestAnimationFrame(() => element.setSelectionRange(edit.text.length, edit.text.length));
  }, [edit]);

  // Агент задал вопрос — фокус на ленте, а не в поле: так работают цифры выбора.
  useEffect(() => {
    if (pending) field.current?.blur();
  }, [pending]);

  // «Спросить ассистента» и Ctrl+L зовут фокус сюда. Поле могло смонтироваться уже после
  // просьбы — вкладка только открылась, — поэтому просьбу забирают, а не ловят.
  const focusRequest = deck?.focusRequest ?? 0;
  const takeFocus = deck?.takeFocus;
  useEffect(() => {
    if (takeFocus?.()) field.current?.focus();
  }, [focusRequest, takeFocus]);

  const send = () => {
    if (action.action === 'stop') {
      if (run) generationRuns.cancel(run.runId);
      return;
    }
    const message = text.trim();
    if (message === '') return;
    setText('');
    if (thread && pending) {
      assistantThreads.answer(thread.threadId, pending.id, { optionId: null, text: message });
      return;
    }
    let threadId = thread?.threadId;
    if (!threadId) {
      threadId = assistantThreads.create('');
      if (deckId) assistantThreads.setDeck(threadId, deckId);
    }
    // Снимок объектов на момент отправки: закреплённое и призрак, без устаревшего.
    const attachments = deck
      ? contextAttachments(deck.slides, deck.ghost ? [...deck.refs, deck.ghost] : deck.refs)
      : [];
    deckConversations.say(threadId, message, attachments);
    deck?.sent();
  };

  return (
    <div className="shrink-0 px-3 pt-1 pb-3">
      <PromptBox box={box} size="compact" onSubmit={send}>
        {deck && (deck.refs.length > 0 || deck.ghost) ? (
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
        <PromptField
          value={text}
          onValueChange={setText}
          label={t('label')}
          placeholder={pending ? t('placeholderAnswer') : t('placeholder')}
          fieldRef={field}
        />
        <PromptToolbar
          end={
            <>
              {thread && threadModel !== undefined ? (
                <ModelMenu
                  compact
                  value={model}
                  onChange={(next) => {
                    setModel(next);
                    deckConversations.setModel(thread.threadId, next);
                  }}
                />
              ) : null}
              <PromptSubmit state={action} label={t('send')} stopLabel={t('stop')} />
            </>
          }
        />
      </PromptBox>
    </div>
  );
}
