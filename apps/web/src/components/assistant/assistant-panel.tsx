'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import { ModelMenu } from '@/components/composer/model-menu';
import { useAurora } from '@/components/composer/use-aurora';
import { Button } from '@/components/ui/button';
import { AgentIcon, SendIcon, StopIcon } from '@/components/ui/icons';
import { AttachmentChip } from '@/components/composer/attachment-chip';
import type { AssistantThread } from '@/lib/assistant-threads';
import type { ModelRef } from '@/lib/model-settings';
import { contextAttachments, refKey } from '@/lib/slide-context';
import { cn } from '@/lib/utils';
import { useAssistantDeck } from './deck-context';
import { assistantThreads, deckConversations, generationRuns, useRun } from './session';
import { ResultCard } from './result-card';
import {
  AgentMessage,
  AskCard,
  AssumptionCard,
  ImportCard,
  TemplateCard,
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
          messages.map((message, index) => {
            const agentStarts =
              message.kind !== 'user' && (index === 0 || messages[index - 1]?.kind === 'user');
            return (
              <div
                key={message.id}
                className="assistant-rise flex flex-col gap-2 motion-reduce:animate-none"
              >
                {agentStarts ? <AgentName /> : null}
                {message.kind === 'user' ? (
                  <UserMessage message={message} />
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
      </div>
      <AssistantInput thread={thread} deckId={deckId} />
    </div>
  );
}

function AgentName() {
  const t = useTranslations('assistant');
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <AgentIcon className="size-3.5 text-[var(--aurora-color,var(--foreground))]" aria-hidden />
      {t('name')}
    </p>
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
}: {
  thread: AssistantThread | undefined;
  deckId?: string;
}) {
  const t = useTranslations('assistant.input');
  const tc = useTranslations('assistant.context');
  const deck = useAssistantDeck();
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  // Модель — у разговора, который собирает колоду; разговор, начатый в панели, колод не собирает.
  const threadModel = thread ? deckConversations.modelOf(thread.threadId) : undefined;
  const [model, setModel] = useState<ModelRef | null>(threadModel ?? null);
  const run = useRun(activeRunId(thread));
  const running = run?.phase === 'running';
  const pending = thread ? assistantThreads.pendingQuestion(thread.threadId) : undefined;
  const ready = text.trim() !== '';
  const aurora = useAurora(root, { ready, sending: running });

  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [text]);

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
    if (running && run) {
      generationRuns.cancel(run.runId);
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

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div className="shrink-0 px-3 pt-1 pb-3">
      <div ref={root} {...aurora.handlers} className="aurora rounded-xl">
        <div aria-hidden className="aurora-halo" />
        <div aria-hidden className="aurora-ring" />
        <form
          onSubmit={onSubmit}
          className="relative z-1 flex flex-col rounded-[inherit] bg-card ring-1 ring-border"
        >
          <textarea
            ref={field}
            value={text}
            rows={1}
            aria-label={t('label')}
            placeholder={pending ? t('placeholderAnswer') : t('placeholder')}
            onChange={(event) => {
              setText(event.currentTarget.value);
              aurora.kick();
            }}
            onKeyDown={onKeyDown}
            className={cn(
              'max-h-48 min-h-11 w-full resize-none overflow-y-auto bg-transparent px-3.5 pt-3 pb-0.5',
              'text-[0.8125rem] text-foreground outline-none placeholder:text-muted-foreground',
            )}
          />
          {deck && (deck.refs.length > 0 || deck.ghost) ? (
            <ul aria-label={tc('label')} className="flex flex-wrap gap-1.5 px-2.5 pt-1.5 pb-0.5">
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
            </ul>
          ) : null}
          <div className="flex items-center justify-end gap-1 px-2 pb-2">
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
            <Button
              type="submit"
              size="icon"
              disabled={!running && !ready}
              aria-label={running ? t('stop') : t('send')}
              className="rounded-full"
            >
              {running ? <StopIcon /> : <SendIcon className="[--icon-stroke:2]" />}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
