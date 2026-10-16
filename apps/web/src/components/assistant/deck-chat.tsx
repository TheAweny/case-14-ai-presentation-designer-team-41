'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useReducedMotion } from 'motion/react';
import { ChatSkeleton } from '@/components/library/page-skeletons';
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
import { AgentIcon, BackIcon, RetryIcon, TemplateIcon } from '@/components/ui/icons';
import { latestResult, partsOf } from '@/lib/chat-records';
import type { ChatView } from '@/lib/chat-store';
import { deckHref, projectHref } from '@/lib/library-menu';
import type { TemplateSummary } from '@/lib/library-source';
import { projectColorVar } from '@/lib/project-appearance';
import { ChatComposer, type EditRequest } from './chat-composer';
import { ChatThread } from './chat-thread';
import { chatStore, useChat, useHydrated } from './session';
import { ThreadDensityContext } from './thread-messages';
import { JumpToLatest } from './thread-jump';

/** Подсказки после готовой колоды: подпись на кнопке и то, что уйдёт агенту. */
const SUGGESTIONS = ['shorter', 'numbers', 'simpler'] as const;

/**
 * Чат с агентом — отдельная страница, как в Claude: сообщения по центру, поле внизу. Здесь можно
 * просто поговорить, обсудить презентацию, получить от агента план, поправить и одобрить его, а
 * потом забрать готовую колоду: три варианта, которые можно посмотреть, показать и скачать, не
 * открывая редактор.
 *
 * Разговор ведёт агент на сервере: после обновления страницы или с другого устройства страница
 * берёт чат из API и досматривает ответ, если он ещё пишется.
 */
export function DeckChat({
  chatId,
  templates,
}: {
  chatId: string;
  /** Шаблоны библиотеки: для плана и чтобы собрать ту же колоду в другом шаблоне. */
  templates: readonly TemplateSummary[];
}) {
  const t = useTranslations('deckChat');
  const tSplash = useTranslations('splash');
  const hydrated = useHydrated();
  const chat = useChat(chatId);
  const projects = useLibraryProjects();
  // «Изменить» у реплики: текст возвращается в поле. `key` различает два нажатия на одну реплику.
  const [edit, setEdit] = useState<EditRequest | null>(null);
  // Ленту прокрутили вверх — над полем кнопка «К последнему». Прокручивает ленту она сама.
  const [away, setAway] = useState(false);
  const jump = useRef<() => void>(() => undefined);
  const field = useRef<HTMLTextAreaElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    let live = true;
    chatStore.load(chatId).catch(() => {
      if (live) setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [hydrated, chatId]);

  if (!hydrated || (!chat && !failed) || chat?.status === 'loading') {
    return <ChatSkeleton label={tSplash('page')} />;
  }
  if (!chat || chat.status === 'missing') {
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

  const project = projects.find((item) => item.projectId === chat.projectId);
  const result = latestResult(chat.messages);
  const deckId =
    chat.deckId ??
    (result
      ? (result.variants.find((item) => item.variant === result.recommended)?.deckId ?? null)
      : null);
  const templateId = partsOf(chat.messages, 'build').at(-1)?.part.templateId ?? null;
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
          <Link href={project ? projectHref(project.projectId) : '/'}>
            <BackIcon />
          </Link>
        </Button>
        <h1 className="min-w-0 truncate text-sm font-medium">{chat.title || t('untitled')}</h1>
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
        chat={chat}
        templates={templates}
        onEdit={(text) => setEdit({ text, key: Date.now() })}
        onRefine={() => field.current?.focus()}
        onAwayChange={setAway}
        jumpRef={jump}
      />
      <div className="sticky bottom-0 z-10 shrink-0 bg-background px-4 pt-2 pb-4 md:static md:bg-transparent md:pt-0">
        <div className="mx-auto w-full max-w-3xl">
          <ChatComposer
            chat={chat}
            templates={templates}
            edit={edit}
            fieldRef={field}
            above={away ? <JumpToLatest onJump={() => jump.current()} /> : null}
          />
        </div>
      </div>
    </div>
  );
}

function ChatLog({
  chat,
  templates,
  onEdit,
  onRefine,
  onAwayChange,
  jumpRef,
}: {
  chat: ChatView;
  templates: readonly TemplateSummary[];
  onEdit: (text: string) => void;
  onRefine: () => void;
  /** Ленту увели от низа или вернули к нему. */
  onAwayChange: (away: boolean) => void;
  /** Сюда лента кладёт «прокрутить к последнему» — для кнопки над полем. */
  jumpRef: RefObject<() => void>;
}) {
  const t = useTranslations('deckChat');
  const list = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const reduce = useReducedMotion();
  const follow = (atBottom: boolean) => {
    stick.current = atBottom;
    onAwayChange(!atBottom);
  };
  const toBottom = () => {
    follow(true);
    const element = list.current;
    if (element && scrollsItself(element)) {
      element.scrollTo({ top: element.scrollHeight, behavior: reduce ? 'instant' : 'smooth' });
    } else end.current?.scrollIntoView({ block: 'end', behavior: reduce ? 'instant' : 'smooth' });
  };
  const { messages } = chat;
  // Новая реплика человека — из поля, из черновика или ответом на вопрос.
  const lastUser =
    chat.pending?.text ?? messages.findLast((message) => message.role === 'user')?.id;
  const seenUser = useRef(lastUser);
  const result = latestResult(messages);
  const last = messages.at(-1);
  const showNext =
    !chat.running &&
    result !== null &&
    last?.role === 'assistant' &&
    last.parts.some((part) => part === result);

  useEffect(() => {
    jumpRef.current = toBottom;
  });

  // Лента держится у низа, пока человек сам не прокрутил её вверх. Его новая реплика возвращает
  // ленту вниз: ответ на неё будет там.
  useLayoutEffect(() => {
    const element = list.current;
    if (lastUser !== seenUser.current) {
      seenUser.current = lastUser;
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

  const empty = messages.length === 0 && chat.pending === null;
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
          {empty ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <AgentIcon className="size-5 text-muted-foreground" aria-hidden />
              <p className="text-base font-semibold">{t('empty.title')}</p>
              <p className="max-w-sm text-sm text-pretty text-muted-foreground">
                {t('empty.body')}
              </p>
            </div>
          ) : null}
          <ChatThread chat={chat} templates={templates} onEdit={onEdit} onRefine={onRefine} />
          {showNext ? <NextSteps chat={chat} templates={templates} /> : null}
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

/**
 * Что можно сделать с готовой колодой, кроме как открыть: собрать её в другом шаблоне, собрать
 * заново или попросить поправить словами. Всё это — обычные сообщения агенту.
 */
function NextSteps({ chat, templates }: { chat: ChatView; templates: readonly TemplateSummary[] }) {
  const t = useTranslations('deckChat.next');
  const tt = useTranslations('composer.template');
  const currentTemplateId = partsOf(chat.messages, 'build').at(-1)?.part.templateId;
  const others = templates.filter((template) => template.templateId !== currentTemplateId);
  const say = (text: string, template?: TemplateSummary) =>
    chatStore.send(chat.chatId, {
      text,
      files: [],
      template: template ? { templateId: template.templateId, name: template.fileName } : null,
    });

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
                  say(t('otherTemplateSaid', { template: template.fileName }), template)
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
          onClick={() => say(t('againSaid'))}
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
            onClick={() => say(t(`suggestions.${id}.text`))}
          >
            {t(`suggestions.${id}.label`)}
          </Button>
        ))}
      </div>
    </div>
  );
}
