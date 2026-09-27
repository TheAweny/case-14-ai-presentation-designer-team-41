'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AttachmentChip } from '@/components/composer/attachment-chip';
import { ModelMenu } from '@/components/composer/model-menu';
import { useAurora } from '@/components/composer/use-aurora';
import { ProjectIcon } from '@/components/library/project-icon';
import { useLibraryProjects } from '@/components/library/library-projects';
import { PaletteStrip } from '@/components/library/template-swatch';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AgentIcon,
  AttachIcon,
  BackIcon,
  SendIcon,
  StopIcon,
  TemplateIcon,
} from '@/components/ui/icons';
import type { AssistantThread, ThreadMessage } from '@/lib/assistant-threads';
import { addContentFiles, CONTENT_FILE_ACCEPT } from '@/lib/deck-generator';
import type { TemplateSummary } from '@/lib/library-source';
import type { ModelRef } from '@/lib/model-settings';
import { projectColorVar } from '@/lib/project-appearance';
import { cn } from '@/lib/utils';
import { BuildCard } from './build-card';
import { ResultCard } from './result-card';
import {
  assistantThreads,
  deckConversations,
  generationRuns,
  useHydrated,
  useRun,
  useThread,
} from './session';
import {
  AgentMessage,
  AskCard,
  AssumptionCard,
  ImportCard,
  TemplateCard,
  ThreadDensityContext,
  UserMessage,
} from './thread-messages';

/** Подсказки после готовой колоды: подпись на кнопке и то, что уйдёт агенту. */
const SUGGESTIONS = ['shorter', 'numbers', 'simpler'] as const;

/** Первая строка брифа — название разговора. */
function workingTitle(thread: AssistantThread): string | null {
  const first = thread.messages[0];
  if (first?.kind !== 'user') return null;
  return (
    first.text
      .split('\n')
      .find((line) => line.trim() !== '')
      ?.trim() ?? null
  );
}

/** Прогон последней сборки разговора. */
function latestRunId(thread: AssistantThread): string | null {
  const work = thread.messages.findLast((message) => message.kind === 'work');
  return work?.kind === 'work' ? work.runId : null;
}

/**
 * Разговор о новой колоде — отдельная страница, как чат: сообщения по центру, поле внизу. Здесь
 * агент собирает колоду, показывает ход и отдаёт готовый результат: три варианта, которые можно
 * посмотреть, показать и скачать, не открывая редактор. Пожелания пишут в поле — агент
 * пересобирает колоду.
 *
 * Разговор живёт во вкладке: после обновления страницы его нет, и страница говорит об этом.
 */
export function DeckChat({
  threadId,
  templates,
}: {
  threadId: string;
  /** Шаблоны библиотеки: в любом из них можно собрать ту же колоду заново. */
  templates: readonly TemplateSummary[];
}) {
  const t = useTranslations('deckChat');
  const hydrated = useHydrated();
  const thread = useThread(threadId);
  const projects = useLibraryProjects();

  if (!hydrated) return <div className="min-h-dvh md:h-full md:min-h-0" />;
  if (!thread) {
    return (
      <div className="grid min-h-dvh place-items-center px-6 md:h-full md:min-h-0">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <AgentIcon className="size-5 text-muted-foreground" aria-hidden />
          <h1 className="text-base font-semibold">{t('notFound.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('notFound.body')}</p>
          <Button asChild variant="outline">
            <Link href="/">{t('notFound.home')}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const project = projects.find((item) => item.projectId === thread.projectId);
  return (
    // На широком экране прокручивается лента, а шапка и поле стоят на месте. На телефоне
    // прокручивается документ под шапкой меню, а шапка разговора и поле прилипают к краям.
    <div
      className="flex min-h-dvh flex-col md:h-full md:min-h-0"
      style={
        {
          '--aurora-color': project
            ? projectColorVar(project.appearance.color)
            : 'var(--project-gray)',
        } as CSSProperties
      }
    >
      <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3 md:static">
        <Button asChild variant="ghost" size="icon" aria-label={t('back')}>
          <Link href={deckConversations.returnHref(threadId) ?? '/'}>
            <BackIcon />
          </Link>
        </Button>
        <h1 className="min-w-0 truncate text-sm font-medium">
          {workingTitle(thread) ?? t('untitled')}
        </h1>
        {project ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full py-0.5 pr-2 pl-1 text-xs text-muted-foreground ring-1 ring-border">
            <ProjectIcon appearance={project.appearance} size="sm" />
            <span className="max-w-40 truncate">{project.name}</span>
          </span>
        ) : null}
      </header>
      <ChatLog thread={thread} templates={templates} />
      <ChatComposer thread={thread} />
    </div>
  );
}

function ChatLog({
  thread,
  templates,
}: {
  thread: AssistantThread;
  templates: readonly TemplateSummary[];
}) {
  const t = useTranslations('deckChat');
  const list = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const { messages, threadId } = thread;
  const runId = latestRunId(thread);
  const last = messages.at(-1);
  const lastUserId = messages.findLast((message) => message.kind === 'user')?.id;
  const seenUserId = useRef(lastUserId);

  // Лента держится у низа, пока человек сам не прокрутил её вверх. Его новая реплика — из поля,
  // из карточки допущения или подсказок — возвращает ленту вниз: ответ на неё будет там.
  useLayoutEffect(() => {
    const element = list.current;
    if (lastUserId !== seenUserId.current) {
      seenUserId.current = lastUserId;
      stick.current = true;
    }
    if (!element || !stick.current) return;
    if (scrollsItself(element)) element.scrollTop = element.scrollHeight;
    else end.current?.scrollIntoView({ block: 'end' });
  });

  // На телефоне прокручивается документ: прилипание к низу следит за ним.
  useEffect(() => {
    const onScroll = () => {
      const element = list.current;
      const page = document.scrollingElement;
      if (!element || !page || scrollsItself(element)) return;
      stick.current = page.scrollHeight - page.scrollTop - window.innerHeight < 160;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      ref={list}
      role="log"
      aria-label={t('log')}
      aria-live="polite"
      onScroll={(event) => {
        const element = event.currentTarget;
        stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
      }}
      className="flex-1 md:min-h-0 md:overflow-y-auto"
    >
      <ThreadDensityContext.Provider value="comfortable">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-8 pb-6">
          {messages.map((message, index) => {
            const agentStarts =
              message.kind !== 'user' && (index === 0 || messages[index - 1]?.kind === 'user');
            return (
              <div
                key={message.id}
                className="assistant-rise flex flex-col gap-2.5 motion-reduce:animate-none"
              >
                {agentStarts ? <AgentName /> : null}
                <ChatMessage threadId={threadId} message={message} latestRunId={runId} />
              </div>
            );
          })}
          {last?.kind === 'result' ? (
            <NextSteps threadId={threadId} templates={templates} runId={last.result.runId} />
          ) : null}
          {/* Низ ленты: на телефоне его закрывает прилипшее поле, отсюда и отступ. */}
          <div ref={end} aria-hidden className="scroll-mb-32 md:scroll-mb-0" />
        </div>
      </ThreadDensityContext.Provider>
    </div>
  );
}

/** Лента прокручивается сама (широкий экран), а не вместе с документом (телефон). */
function scrollsItself(element: HTMLElement): boolean {
  return element.scrollHeight > element.clientHeight + 1;
}

function ChatMessage({
  threadId,
  message,
  latestRunId: latest,
}: {
  threadId: string;
  message: ThreadMessage;
  latestRunId: string | null;
}) {
  switch (message.kind) {
    case 'user':
      return <UserMessage message={message} />;
    case 'agent':
      return <AgentMessage text={message.text} />;
    case 'work':
      return <BuildCard runId={message.runId} latest={message.runId === latest} />;
    case 'import':
      return <ImportCard importId={message.importId} />;
    case 'template':
      return <TemplateCard template={message.template} threadId={threadId} />;
    case 'assume':
      return <AssumptionCard threadId={threadId} message={message} />;
    case 'result':
      return <ResultCard threadId={threadId} result={message.result} />;
    case 'ask':
      return (
        <>
          <AskCard threadId={threadId} message={message} />
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
      );
  }
}

function AgentName() {
  const t = useTranslations('assistant');
  return (
    <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <AgentIcon className="size-4 text-[var(--aurora-color,var(--foreground))]" aria-hidden />
      {t('name')}
    </p>
  );
}

/**
 * Что можно сделать с готовой колодой, кроме как открыть: собрать её в другом шаблоне или
 * попросить поправить словами. Всё это — новая сборка, правки руками не нужны.
 */
function NextSteps({
  threadId,
  templates,
  runId,
}: {
  threadId: string;
  templates: readonly TemplateSummary[];
  runId: string;
}) {
  const t = useTranslations('deckChat.next');
  const tt = useTranslations('composer.template');
  const run = useRun(runId);
  const currentTemplateId = run?.request.templateId;
  const others = templates.filter((template) => template.templateId !== currentTemplateId);

  return (
    <div className="assistant-rise flex flex-col gap-2 motion-reduce:animate-none">
      <p className="text-xs text-muted-foreground">{t('title')}</p>
      <div className="flex flex-wrap gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="rounded-full"
              disabled={others.length === 0}
            >
              <TemplateIcon data-icon="inline-start" />
              {t('otherTemplate')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel>{t('otherTemplateTitle')}</DropdownMenuLabel>
            {others.map((template) => (
              <DropdownMenuItem
                key={template.templateId}
                onSelect={() =>
                  deckConversations.rebuildWithTemplate(
                    threadId,
                    { templateId: template.templateId, name: template.fileName },
                    t('otherTemplateSaid', { template: template.fileName }),
                  )
                }
              >
                <PaletteStrip
                  system={template.designSystem}
                  className="w-8 shrink-0 ring-1 ring-border"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{template.fileName}</span>
                  <span className="text-[0.6875rem] text-muted-foreground">
                    {tt('layouts', { count: template.layouts.length })}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {SUGGESTIONS.map((id) => (
          <Button
            key={id}
            type="button"
            variant="outline"
            size="lg"
            className="rounded-full font-normal"
            onClick={() => deckConversations.refine(threadId, t(`suggestions.${id}.text`))}
          >
            {t(`suggestions.${id}.label`)}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * Поле разговора. Вопрос агента ждёт ответа — текст уходит ответом. Иначе это пожелание к колоде:
 * агент пересоберёт её с ним. Пока сборка идёт, кнопка отправки пустого поля — «Стоп».
 */
function ChatComposer({ thread }: { thread: AssistantThread }) {
  const t = useTranslations('deckChat.input');
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<readonly File[]>([]);
  const [rejected, setRejected] = useState<readonly string[]>([]);
  const [dragging, setDragging] = useState(false);
  // Модель следующей сборки: сначала та, что выбрали у поля на главной.
  const [model, setModel] = useState<ModelRef | null>(
    () => deckConversations.modelOf(thread.threadId) ?? null,
  );
  const buildsDecks = deckConversations.modelOf(thread.threadId) !== undefined;
  const run = useRun(latestRunId(thread));
  const running = run?.phase === 'running';
  const pending = assistantThreads.pendingQuestion(thread.threadId);
  const ready = text.trim() !== '' || files.length > 0;
  const stop = running && !ready;
  const aurora = useAurora(root, { ready, sending: running });

  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [text]);

  const send = () => {
    if (stop && run) {
      generationRuns.cancel(run.runId);
      return;
    }
    const message = text.trim();
    if (message === '' && files.length === 0) return;
    if (pending) {
      if (message === '') return;
      setText('');
      assistantThreads.answer(thread.threadId, pending.id, { optionId: null, text: message });
      return;
    }
    setText('');
    const attached = files;
    setFiles([]);
    setRejected([]);
    deckConversations.refine(thread.threadId, message, attached);
  };

  const addFiles = (added: readonly File[]) => {
    const update = addContentFiles(files, added);
    setFiles(update.files);
    setRejected(update.rejected);
    if (update.files.length > files.length) aurora.kick();
  };

  const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');
  const onDragOver = (event: DragEvent) => {
    if (!carriesFiles(event) || pending) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
  };
  const onDrop = (event: DragEvent) => {
    if (!carriesFiles(event) || pending) return;
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
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
    <div className="sticky bottom-0 z-10 shrink-0 bg-background px-4 pt-2 pb-4 md:static md:bg-transparent md:pt-0">
      <div className="mx-auto w-full max-w-3xl">
        <div
          ref={root}
          {...aurora.handlers}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className="aurora rounded-2xl"
        >
          <div aria-hidden className="aurora-halo" />
          <div aria-hidden className="aurora-ring" />
          <form
            onSubmit={onSubmit}
            className="relative z-1 flex flex-wrap items-end gap-2 rounded-[inherit] bg-card p-2 pl-4 ring-1 ring-border"
          >
            <textarea
              ref={field}
              value={text}
              rows={1}
              aria-label={t('label')}
              placeholder={
                pending
                  ? t('placeholderAnswer')
                  : running
                    ? t('placeholderRunning')
                    : t('placeholder')
              }
              onChange={(event) => {
                setText(event.currentTarget.value);
                aurora.kick();
              }}
              onKeyDown={onKeyDown}
              className={cn(
                'max-h-48 min-h-9 flex-1 resize-none overflow-y-auto bg-transparent py-2',
                'text-[0.9375rem] text-foreground outline-none placeholder:text-muted-foreground',
              )}
            />
            {files.length > 0 ? (
              <ul aria-label={t('files')} className="order-first flex basis-full flex-wrap gap-1.5">
                {files.map((file, index) => (
                  <AttachmentChip
                    key={`${file.name}-${file.size}-${file.lastModified}`}
                    attachment={{ kind: 'file', name: file.name, size: file.size }}
                    onRemove={() => setFiles((current) => current.filter((_, at) => at !== index))}
                  />
                ))}
              </ul>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              disabled={Boolean(pending)}
              aria-label={t('attach')}
              onClick={() => picker.current?.click()}
              className="rounded-full text-muted-foreground"
            >
              <AttachIcon />
            </Button>
            <input
              ref={picker}
              type="file"
              multiple
              accept={CONTENT_FILE_ACCEPT}
              tabIndex={-1}
              aria-hidden
              className="sr-only"
              onChange={(event) => {
                addFiles(Array.from(event.currentTarget.files ?? []));
                event.currentTarget.value = '';
              }}
            />
            {buildsDecks ? (
              <ModelMenu
                value={model}
                onChange={(next) => {
                  setModel(next);
                  deckConversations.setModel(thread.threadId, next);
                }}
              />
            ) : null}
            <Button
              type="submit"
              size="icon-lg"
              disabled={!stop && !ready}
              aria-label={stop ? t('stop') : t('send')}
              className="rounded-full"
            >
              {stop ? (
                <StopIcon />
              ) : (
                <SendIcon className={cn('[--icon-stroke:2]', running && 'animate-pulse')} />
              )}
            </Button>
          </form>
          {dragging ? (
            <div className="pointer-events-none absolute inset-0 z-3 grid place-items-center rounded-[inherit] border border-dashed border-foreground/40 bg-card/90 text-sm text-foreground">
              {t('dropHere')}
            </div>
          ) : null}
        </div>
        {rejected.length > 0 ? (
          <p role="alert" className="mt-1 px-1 text-xs text-destructive">
            {t('rejected', { names: rejected.join(', ') })}
          </p>
        ) : null}
        <p className="mt-2 text-center text-[0.6875rem] text-muted-foreground">{t('hint')}</p>
      </div>
    </div>
  );
}
