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
import { HugeiconsIcon } from '@hugeicons/react';
import { AiSparklesIcon, ArrowUp02Icon, StopIcon } from '@hugeicons/core-free-icons';
import { ModelMenu } from '@/components/composer/model-menu';
import { useAurora } from '@/components/composer/use-aurora';
import { Button } from '@/components/ui/button';
import type { AssistantThread } from '@/lib/assistant-threads';
import { cn } from '@/lib/utils';
import {
  assistantThreads,
  deckConversations,
  generationRuns,
  useRun,
  writerModels,
} from './session';
import {
  AgentMessage,
  AskCard,
  ImportCard,
  TemplateCard,
  UserMessage,
  WorkCard,
} from './thread-messages';

/**
 * Панель «Ассистент»: разговор с агентом о колоде. Здесь идёт генерация новой колоды — ход,
 * вопросы с вариантами, выбор варианта вёрстки — и здесь же потом просят правки.
 *
 * Разговора может ещё не быть: колоду открыли из меню. Тогда первое сообщение его начинает и
 * привязывает к колоде.
 */
export function AssistantPanel({
  thread,
  deckId,
  glowColor,
  onPreviewVariant,
}: {
  thread: AssistantThread | undefined;
  /** Колода редактора: к ней привяжется разговор, начатый в панели. */
  deckId?: string;
  /** Цвет свечения поля — цвет проекта; без него свечение нейтральное. */
  glowColor?: string;
  /** Вариант вёрстки под указателем в вопросе о варианте; null — показать выбранный. */
  onPreviewVariant?: (optionId: string | null) => void;
}) {
  const t = useTranslations('assistant');
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const messages = thread?.messages ?? [];

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
            <HugeiconsIcon
              icon={AiSparklesIcon}
              size={20}
              strokeWidth={1.5}
              className="text-muted-foreground"
            />
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
                  <WorkCard runId={message.runId} />
                ) : message.kind === 'import' ? (
                  <ImportCard importId={message.importId} />
                ) : message.kind === 'template' ? (
                  thread ? (
                    <TemplateCard template={message.template} threadId={thread.threadId} />
                  ) : null
                ) : thread ? (
                  <>
                    <AskCard
                      threadId={thread.threadId}
                      message={message}
                      onPreview={
                        message.question.questionId === 'variant' && message.answer === null
                          ? onPreviewVariant
                          : undefined
                      }
                    />
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
                ) : null}
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
      <HugeiconsIcon
        icon={AiSparklesIcon}
        size={14}
        strokeWidth={1.75}
        className="text-[var(--aurora-color,var(--foreground))]"
        aria-hidden
      />
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
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [modelId, setModelId] = useState<string | null>(null);
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
    deckConversations.say(threadId, message);
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
          <div className="flex items-center justify-end gap-1 px-2 pb-2">
            <ModelMenu
              models={writerModels}
              value={modelId}
              onChange={(next) => setModelId(next)}
            />
            <Button
              type="submit"
              size="icon"
              disabled={!running && !ready}
              aria-label={running ? t('stop') : t('send')}
              className="rounded-full"
            >
              <HugeiconsIcon
                icon={running ? StopIcon : ArrowUp02Icon}
                strokeWidth={2}
                className={cn(running && 'fill-current')}
              />
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
