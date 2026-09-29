'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import Link from 'next/link';
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
  PlusIcon,
  BackIcon,
  RetryIcon,
  ScrollDownIcon,
  TemplateIcon,
} from '@/components/ui/icons';
import type { AssistantThread, ThreadMessage } from '@/lib/assistant-threads';
import { chatDeckId, conversationTitle } from '@/lib/chat-records';
import { deckHref } from '@/lib/library-menu';
import { addContentFiles, CONTENT_FILE_ACCEPT } from '@/lib/deck-generator';
import type { TemplateSummary } from '@/lib/library-source';
import type { ModelRef } from '@/lib/model-settings';
import { projectColorVar } from '@/lib/project-appearance';
import { BuildCard } from './build-card';
import { ResultCard } from './result-card';
import {
  assistantThreads,
  chatSync,
  deckConversations,
  generationRuns,
  loadChat,
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
  ThinkingLine,
  ThreadDensityContext,
  UserMessage,
} from './thread-messages';

/** Подсказки после готовой колоды: подпись на кнопке и то, что уйдёт агенту. */
const SUGGESTIONS = ['shorter', 'numbers', 'simpler'] as const;

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
 * Разговор сохраняется в API: после обновления страницы или с другого устройства страница
 * берёт его оттуда, и пожелания снова пересобирают колоду. В шапке — что это за презентация и
 * путь в редактор.
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
  // «Изменить» у реплики: текст возвращается в поле. `key` различает два нажатия на одну реплику.
  const [edit, setEdit] = useState<EditRequest | null>(null);
  // Ленту прокрутили вверх — над полем кнопка «К последнему». Прокручивает ленту она сама.
  const [away, setAway] = useState(false);
  const jump = useRef<() => void>(() => undefined);
  // Разговора нет во вкладке — его приносит API. null — ещё не спросили.
  const [stored, setStored] = useState<{ chatId: string; found: boolean } | null>(null);
  const untitled = t('untitled');

  useEffect(() => {
    chatSync?.setUntitled(untitled);
  }, [untitled]);

  useEffect(() => {
    if (!hydrated || thread) return;
    let live = true;
    loadChat(threadId).then(
      (found) => live && setStored({ chatId: threadId, found }),
      () => live && setStored({ chatId: threadId, found: false }),
    );
    return () => {
      live = false;
    };
  }, [hydrated, thread, threadId]);

  const loading = !thread && (stored === null || stored.chatId !== threadId);
  if (!hydrated || loading) return <div className="min-h-dvh md:h-full md:min-h-0" />;
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
  const deckId = chatDeckId(thread);
  const templateId = deckConversations.snapshot(threadId)?.templateId ?? null;
  const template = templates.find((item) => item.templateId === templateId);
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
          {conversationTitle(thread) ?? t('untitled')}
        </h1>
        {project ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full py-0.5 pr-2 pl-1 text-xs text-muted-foreground ring-1 ring-border">
            <ProjectIcon appearance={project.appearance} size="sm" />
            <span className="max-w-40 truncate">{project.name}</span>
          </span>
        ) : null}
        {template ? (
          <span
            className="hidden shrink-0 items-center gap-1.5 rounded-full py-0.5 pr-2 pl-1.5 text-xs text-muted-foreground ring-1 ring-border sm:flex"
            title={t('header.template', { template: template.fileName })}
          >
            <PaletteStrip system={template.designSystem} className="h-2 w-4 rounded-full" />
            <span className="max-w-40 truncate">{template.fileName}</span>
          </span>
        ) : null}
        {deckId ? (
          <Button asChild variant="outline" size="sm" className="ml-auto shrink-0">
            <Link href={deckHref(deckId)}>{t('header.openEditor')}</Link>
          </Button>
        ) : null}
      </header>
      <ChatLog
        thread={thread}
        templates={templates}
        onEdit={(text) => setEdit({ text, key: Date.now() })}
        onAwayChange={setAway}
        jumpRef={jump}
      />
      <ChatComposer
        thread={thread}
        edit={edit}
        above={away ? <JumpToLatest onJump={() => jump.current()} /> : null}
      />
    </div>
  );
}

/** Текст реплики, который вернули в поле кнопкой «Изменить». */
interface EditRequest {
  readonly text: string;
  readonly key: number;
}

function ChatLog({
  thread,
  templates,
  onEdit,
  onAwayChange,
  jumpRef,
}: {
  thread: AssistantThread;
  templates: readonly TemplateSummary[];
  onEdit: (text: string) => void;
  /** Ленту увели от низа или вернули к нему. */
  onAwayChange: (away: boolean) => void;
  /** Сюда лента кладёт «прокрутить к последнему» — для кнопки над полем. */
  jumpRef: RefObject<() => void>;
}) {
  const t = useTranslations('deckChat');
  const list = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const follow = (atBottom: boolean) => {
    stick.current = atBottom;
    onAwayChange(!atBottom);
  };
  const toBottom = () => {
    follow(true);
    const element = list.current;
    if (element && scrollsItself(element)) {
      element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
    } else end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  };
  const { messages, threadId } = thread;
  const runId = latestRunId(thread);
  // У последней сборки есть итог: её карточка без прогона во вкладке — просто завершённая сборка.
  const latestSettled =
    messages.findLastIndex((message) => message.kind === 'result') >
    messages.findLastIndex((message) => message.kind === 'work');
  const last = messages.at(-1);
  const lastUserId = messages.findLast((message) => message.kind === 'user')?.id;
  const seenUserId = useRef(lastUserId);

  useEffect(() => {
    jumpRef.current = toBottom;
  });

  // Лента держится у низа, пока человек сам не прокрутил её вверх. Его новая реплика — из поля,
  // из карточки допущения или подсказок — возвращает ленту вниз: ответ на неё будет там.
  useLayoutEffect(() => {
    const element = list.current;
    if (lastUserId !== seenUserId.current) {
      seenUserId.current = lastUserId;
      stick.current = true;
      onAwayChange(false);
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
      follow(page.scrollHeight - page.scrollTop - window.innerHeight < 160);
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
        follow(element.scrollHeight - element.scrollTop - element.clientHeight < 64);
      }}
      className="flex-1 md:min-h-0 md:overflow-y-auto"
    >
      <ThreadDensityContext.Provider value="comfortable">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-8 pb-6">
          {messages.map((message) => (
            <div
              key={message.id}
              className="assistant-rise flex flex-col gap-2.5 motion-reduce:animate-none"
            >
              <ChatMessage
                threadId={threadId}
                message={message}
                latestRunId={runId}
                latestSettled={latestSettled}
                onEdit={onEdit}
              />
            </div>
          ))}
          {last?.kind === 'user' ? <ThinkingLine /> : null}
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
  latestSettled,
  onEdit,
}: {
  threadId: string;
  message: ThreadMessage;
  latestRunId: string | null;
  latestSettled: boolean;
  onEdit: (text: string) => void;
}) {
  switch (message.kind) {
    case 'user':
      return <UserMessage message={message} onEdit={onEdit} />;
    case 'agent':
      return <AgentMessage text={message.text} />;
    case 'work':
      return (
        <BuildCard
          runId={message.runId}
          latest={message.runId === latest}
          unfinished={message.runId === latest && !latestSettled}
        />
      );
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
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="rounded-full font-normal"
          onClick={() => deckConversations.again(threadId, t('againSaid'))}
        >
          <RetryIcon data-icon="inline-start" />
          {t('again')}
        </Button>
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
 * агент пересоберёт её с ним, и идущую сборку сменит новая. Пока сборка идёт и поле пустое,
 * кнопка — «Стоп»; начали печатать — снова «Отправить», набранное не пропадает.
 */
/** Кнопка «К последнему сообщению»: висит над полем по центру, не занимая места. */
function JumpToLatest({ onJump }: { onJump: () => void }) {
  const t = useTranslations('deckChat');
  return (
    <div className="pointer-events-none absolute inset-x-0 -top-12 flex justify-center">
      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        onClick={onJump}
        aria-label={t('toBottom')}
        title={t('toBottom')}
        className="assistant-rise pointer-events-auto rounded-full bg-background shadow-sm motion-reduce:animate-none"
      >
        <ScrollDownIcon />
      </Button>
    </div>
  );
}

function ChatComposer({
  thread,
  edit,
  above,
}: {
  thread: AssistantThread;
  /** Реплика, которую вернули в поле кнопкой «Изменить». */
  edit: EditRequest | null;
  /** Что висит над полем: кнопка «К последнему». */
  above: ReactNode;
}) {
  const t = useTranslations('deckChat.input');
  const picker = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');

  // «Изменить»: текст реплики — в поле, курсор — в конец, чтобы сразу дописать.
  useEffect(() => {
    if (!edit) return;
    setText(edit.text);
    const element = field.current;
    if (!element) return;
    element.focus();
    requestAnimationFrame(() => element.setSelectionRange(edit.text.length, edit.text.length));
  }, [edit]);
  const [files, setFiles] = useState<readonly File[]>([]);
  const [rejected, setRejected] = useState<readonly string[]>([]);
  // Модель следующей сборки: сначала та, что выбрали у поля на главной.
  const [model, setModel] = useState<ModelRef | null>(
    () => deckConversations.modelOf(thread.threadId) ?? null,
  );
  const buildsDecks = deckConversations.modelOf(thread.threadId) !== undefined;
  const run = useRun(latestRunId(thread));
  const running = run?.phase === 'running';
  const pending = assistantThreads.pendingQuestion(thread.threadId);
  // На вопрос отвечают словами: файлы к ответу не прикладывают.
  const hasInput = text.trim() !== '' || (!pending && files.length > 0);
  const action = promptAction({ hasInput, running });
  const box = usePromptBox({ ready: hasInput, busy: running });

  const send = () => {
    if (action.action === 'stop') {
      if (run) generationRuns.cancel(run.runId);
      return;
    }
    if (!hasInput) return;
    const message = text.trim();
    setText('');
    if (pending) {
      assistantThreads.answer(thread.threadId, pending.id, { optionId: null, text: message });
      return;
    }
    const attached = files;
    setFiles([]);
    setRejected([]);
    deckConversations.refine(thread.threadId, message, attached);
  };

  const addFiles = (added: readonly File[]) => {
    const update = addContentFiles(files, added);
    setFiles(update.files);
    setRejected(update.rejected);
    if (update.files.length > files.length) box.aurora.kick();
  };

  return (
    <div className="sticky bottom-0 z-10 shrink-0 bg-background px-4 pt-2 pb-4 md:static md:bg-transparent md:pt-0">
      <div className="relative mx-auto w-full max-w-3xl">
        {above}
        <PromptBox
          box={box}
          onSubmit={send}
          onFiles={pending ? undefined : addFiles}
          dropLabel={t('dropHere')}
        >
          {files.length > 0 ? (
            <PromptChips label={t('files')}>
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
              pending
                ? t('placeholderAnswer')
                : running
                  ? t('placeholderRunning')
                  : t('placeholder')
            }
          />
          <PromptToolbar
            end={
              <>
                {buildsDecks ? (
                  <ModelMenu
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
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              disabled={Boolean(pending)}
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
              accept={CONTENT_FILE_ACCEPT}
              tabIndex={-1}
              aria-hidden
              className="sr-only"
              onChange={(event) => {
                addFiles(Array.from(event.currentTarget.files ?? []));
                event.currentTarget.value = '';
              }}
            />
          </PromptToolbar>
        </PromptBox>
        {rejected.length > 0 ? (
          <PromptNote>{t('rejected', { names: rejected.join(', ') })}</PromptNote>
        ) : null}
      </div>
    </div>
  );
}
