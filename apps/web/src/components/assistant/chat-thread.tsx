'use client';

import { Fragment } from 'react';
import { useTranslations } from 'next-intl';
import type { AssistantChatMessage, ChatPart } from '@lct/contracts';
import { CheckIcon, SpinnerIcon, WarningIcon } from '@/components/ui/icons';
import { partsOf, pendingQuestion } from '@/lib/chat-records';
import type { ChatView } from '@/lib/chat-store';
import type { TemplateSummary } from '@/lib/library-source';
import { cn } from '@/lib/utils';
import { ChatBuild, ChatResult } from './chat-build';
import { MessageMarkdown } from './message-markdown';
import { PlanCard } from './plan-card';
import { QuestionCard } from './question-card';
import { chatStore } from './session';
import { ThinkingLine, UserMessage, useMessageText } from './thread-messages';

/** Инструменты, которые показывают себя своей карточкой: плана, вопроса, сборки. */
const CARD_TOOLS = new Set(['ask_user', 'propose_plan', 'build_deck']);

type ToolPart = Extract<ChatPart, { type: 'tool' }>;

/**
 * Лента чата: реплики человека, ответы агента по частям — текст, чтение шаблонов и материалов
 * строками, план, вопрос, ход сборки и её итог карточками. Одна и та же лента стоит на странице
 * чата и в панели редактора; плотность задаёт \`ThreadDensityContext\`.
 */
export function ChatThread({
  chat,
  templates,
  compact = false,
  currentDeckId,
  onEdit,
  onRefine,
}: {
  chat: ChatView;
  templates: readonly TemplateSummary[];
  compact?: boolean;
  currentDeckId?: string;
  onEdit?: (text: string) => void;
  /** «Уточнить» у плана: курсор — в поле. */
  onRefine: () => void;
}) {
  const t = useTranslations('deckChat');
  const { messages, running, pending } = chat;
  const question = pendingQuestion(messages);
  const plans = partsOf(messages, 'plan');
  const latestPlan = plans.at(-1)?.part.planId ?? null;
  const builds = partsOf(messages, 'build');
  const latestBuild = builds.at(-1)?.part.buildId ?? null;
  const last = messages.at(-1);
  // Агент ещё ничего не сказал в этом ходе — ждём его, как в чатах.
  const thinking =
    (pending !== null && pending.failed === null) ||
    (running && (last?.role !== 'assistant' || visibleParts(last).length === 0));

  return (
    <>
      {messages.map((message) => (
        <div
          key={message.id}
          className="assistant-rise flex flex-col gap-2.5 motion-reduce:animate-none"
        >
          {message.role === 'user' ? (
            <UserMessage
              text={message.text}
              attachments={message.attachments.map((attachment) =>
                attachment.kind === 'slides'
                  ? { kind: 'context' as const, name: attachment.name }
                  : attachment,
              )}
              onEdit={onEdit}
            />
          ) : (
            <AssistantMessage
              message={message}
              chatId={chat.chatId}
              templates={templates}
              compact={compact}
              currentDeckId={currentDeckId}
              busy={running}
              activePlanId={latestPlan}
              activeQuestionId={running ? null : (question?.questionId ?? null)}
              latestBuildId={latestBuild}
              onRefine={onRefine}
            />
          )}
        </div>
      ))}
      {pending ? (
        <div className="assistant-rise flex flex-col motion-reduce:animate-none">
          <UserMessage
            text={pending.text}
            attachments={pending.attachments}
            note={
              pending.failed === null
                ? { text: t('pending.uploading'), failed: false }
                : {
                    text: pending.failed
                      ? t('pending.failedWith', { reason: pending.failed })
                      : t('pending.failed'),
                    failed: true,
                  }
            }
          />
        </div>
      ) : null}
      {thinking ? <ThinkingLine /> : null}
    </>
  );
}

/**
 * Части ответа, которые видны. Вызов инструмента с карточкой показывает его карточка; пока
 * карточки нет (агент ещё пишет план), видна строка «Составляю план…».
 */
function visibleParts(message: AssistantChatMessage): ChatPart[] {
  const cards = new Set(
    message.parts.flatMap((part) =>
      part.type !== 'tool' && 'callId' in part ? [part.callId] : [],
    ),
  );
  return message.parts.filter((part) => {
    if (part.type === 'text') return part.text.trim() !== '';
    if (part.type === 'tool' && CARD_TOOLS.has(part.name))
      return part.status === 'running' && !cards.has(part.callId);
    return true;
  });
}

/** Подряд идущие чтения — одной группой строк. */
function grouped(parts: readonly ChatPart[]): (ChatPart | ToolPart[])[] {
  const out: (ChatPart | ToolPart[])[] = [];
  for (const part of parts) {
    const previous = out.at(-1);
    if (part.type === 'tool') {
      if (Array.isArray(previous)) previous.push(part);
      else out.push([part]);
    } else out.push(part);
  }
  return out;
}

function AssistantMessage({
  message,
  chatId,
  templates,
  compact,
  currentDeckId,
  busy,
  activePlanId,
  activeQuestionId,
  latestBuildId,
  onRefine,
}: {
  message: AssistantChatMessage;
  chatId: string;
  templates: readonly TemplateSummary[];
  compact: boolean;
  currentDeckId?: string;
  busy: boolean;
  activePlanId: string | null;
  activeQuestionId: string | null;
  latestBuildId: string | null;
  onRefine: () => void;
}) {
  const t = useTranslations('deckChat');
  const text = useMessageText();
  const parts = grouped(visibleParts(message));
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {Array.isArray(part) ? (
            <ToolLines parts={part} />
          ) : part.type === 'text' ? (
            <MessageMarkdown text={part.text} className={text} />
          ) : part.type === 'plan' ? (
            <PlanCard
              key={part.planId}
              part={part}
              templates={templates}
              compact={compact}
              active={part.status === 'proposed' && part.planId === activePlanId && !busy}
              busy={busy}
              onApprove={(outline, templateId) =>
                chatStore.approve(chatId, part.planId, outline, templateId)
              }
              onRefine={onRefine}
            />
          ) : part.type === 'question' ? (
            <QuestionCard
              key={part.questionId}
              part={part}
              active={part.questionId === activeQuestionId}
              onAnswer={(answer) => chatStore.answer(chatId, part.questionId, answer)}
            />
          ) : part.type === 'build' ? (
            <ChatBuild part={part} latest={part.buildId === latestBuildId} />
          ) : part.type === 'result' ? (
            <ChatResult
              chatId={chatId}
              part={part}
              compact={compact}
              currentDeckId={currentDeckId}
            />
          ) : part.type === 'error' ? (
            <p className="flex items-start gap-2 text-[0.8125rem] text-destructive">
              <WarningIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t('error', { message: part.message })}
            </p>
          ) : null}
        </Fragment>
      ))}
      {message.status === 'cancelled' || message.status === 'failed' ? (
        <p className="text-xs text-muted-foreground">
          {message.status === 'cancelled' ? t('status.cancelled') : t('status.failed')}
        </p>
      ) : null}
    </>
  );
}

const READ_TOOLS = [
  'list_templates',
  'describe_template',
  'read_file',
  'read_deck',
  'read_audit',
] as const;
type ReadTool = (typeof READ_TOOLS)[number];

function isReadTool(name: string): name is ReadTool {
  return (READ_TOOLS as readonly string[]).includes(name);
}

type CardTool = 'ask_user' | 'propose_plan' | 'build_deck';

function isCardTool(name: string): name is CardTool {
  return CARD_TOOLS.has(name);
}

/** Что агент прочитал — тихими строками, как шаги агента в Claude. */
function ToolLines({ parts }: { parts: readonly ToolPart[] }) {
  const t = useTranslations('deckChat.tools');
  return (
    <ul className="flex flex-col gap-1">
      {parts.map((part) => {
        const tool = isReadTool(part.name) ? part.name : null;
        const card = isCardTool(part.name) ? part.name : null;
        const label = card
          ? t(`running.${card}`)
          : part.status === 'failed'
            ? t('failed', { name: tool ? t(tool) : part.name })
            : !tool
              ? part.name
              : part.status === 'running'
                ? t(`running.${tool}`)
                : t(tool);
        return (
          <li
            key={part.callId}
            className={cn(
              'flex items-center gap-2 text-xs',
              part.status === 'failed' ? 'text-destructive/80' : 'text-muted-foreground',
            )}
          >
            {part.status === 'running' ? (
              <SpinnerIcon
                className="size-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            ) : part.status === 'failed' ? (
              <WarningIcon className="size-3.5" aria-hidden />
            ) : (
              <CheckIcon className="size-3.5" aria-hidden />
            )}
            <span className={part.status === 'running' ? 'assistant-shimmer' : undefined}>
              {label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
