'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { useReducedMotion } from 'motion/react';
import { AgentIcon } from '@/components/ui/icons';
import type { TemplateSummary } from '@/lib/library-source';
import { ChatComposer, type EditRequest } from './chat-composer';
import { ChatThread } from './chat-thread';
import { useLastChatMode } from './mode-menu';
import { chatStore, useChat } from './session';
import { JumpToLatest } from './thread-jump';

/**
 * Панель «Ассистент» редактора: чат, который собрал колоду, продолжается здесь — с ходом сборки
 * и итогом, из которого можно перейти на другой вариант вёрстки. Здесь можно обсудить колоду и
 * показать агенту объекты слайда: закреплённые и выделенные уходят с сообщением снимком.
 *
 * Чата у колоды может ещё не быть: её открыли из меню. Тогда панель держит пустой чат, и первое
 * сообщение создаёт его на сервере, привязанным к колоде.
 */
export function AssistantPanel({
  chatId,
  deckId,
  projectId,
  templates,
  glowColor,
}: {
  /** Чат колоды; null — его ещё нет. */
  chatId: string | null;
  /** Колода редактора: к ней привяжется чат, начатый в панели. */
  deckId: string;
  projectId: string | null;
  templates: readonly TemplateSummary[];
  /** Цвет свечения поля — цвет проекта; без него свечение нейтральное. */
  glowColor?: string;
}) {
  const t = useTranslations('assistant');
  const [mode] = useLastChatMode();
  const [draftId] = useState(() => crypto.randomUUID());
  const id = chatId ?? draftId;
  const chat = useChat(id);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [away, setAway] = useState(false);
  const reduce = useReducedMotion();
  const latestUser =
    chat?.pending?.text ?? chat?.messages.findLast((message) => message.role === 'user')?.id;
  const seenUser = useRef(latestUser);
  const field = useRef<HTMLTextAreaElement>(null);
  // «Изменить» у реплики: текст возвращается в поле. `key` различает два нажатия на одну реплику.
  const [edit, setEdit] = useState<EditRequest | null>(null);

  useEffect(() => {
    if (chatId) void chatStore.load(chatId).catch(() => undefined);
    else chatStore.draft(draftId, { projectId, mode, model: null, deckId });
  }, [chatId, draftId, projectId, mode, deckId]);

  // Лента держится у низа, пока человек сам не прокрутил её вверх.
  useLayoutEffect(() => {
    if (seenUser.current !== latestUser) {
      seenUser.current = latestUser;
      stick.current = true;
      setAway(false);
    }
    const element = list.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  });

  const empty = !chat || (chat.messages.length === 0 && chat.pending === null);
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
          setAway(!stick.current);
        }}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3.5 pt-4 pb-2"
      >
        {empty ? (
          <div className="m-auto flex max-w-56 flex-col items-center gap-2.5 text-center">
            <AgentIcon className="size-5 text-muted-foreground" aria-hidden />
            <p className="text-sm text-balance text-muted-foreground">{t('empty')}</p>
          </div>
        ) : null}
        {chat && chat.status === 'ready' ? (
          <ChatThread
            chat={chat}
            templates={templates}
            compact
            currentDeckId={deckId}
            onEdit={(text) => setEdit({ text, key: Date.now() })}
            onRefine={() => field.current?.focus()}
          />
        ) : null}
      </div>
      {chat && chat.status === 'ready' ? (
        <div className="shrink-0 px-3 pt-1 pb-3">
          <ChatComposer
            chat={chat}
            templates={templates}
            edit={edit}
            fieldRef={field}
            deckId={deckId}
            compact
            above={
              away ? (
                <JumpToLatest
                  onJump={() => {
                    stick.current = true;
                    setAway(false);
                    list.current?.scrollTo({
                      top: list.current.scrollHeight,
                      behavior: reduce ? 'instant' : 'smooth',
                    });
                  }}
                />
              ) : null
            }
          />
        </div>
      ) : null}
    </div>
  );
}
