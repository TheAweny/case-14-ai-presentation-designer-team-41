'use client';

import { Fragment } from 'react';
import { useTranslations } from 'next-intl';
import type { AssistantChatMessage, ChatPart } from '@lct/contracts';
import { motion, useReducedMotion } from 'motion/react';
import { CallChip, StatusMark } from './status-mark';
import { ThoughtLine } from './thought-line';
import { partsOf, pendingQuestion } from '@/lib/chat-records';
import { canRetryAnswer, type ChatView } from '@/lib/chat-store';
import type { TemplateSummary } from '@/lib/library-source';
import { cn } from '@/lib/utils';
import { ChatBuild, ChatResult } from './chat-build';
import { MessageMarkdown } from './message-markdown';
import { PlanCard } from './plan-card';
import { SlideEditCard } from '@/components/assistant/slide-edit-card';
import { QuestionCard } from './question-card';
import { chatStore } from './session';
import { MessageActions, ThinkingLine, UserMessage, useMessageText } from './thread-messages';
import { ChatFeedback } from './chat-feedback';
import { ModelErrorCard } from './model-error-card';

/** Инструменты, которые показывают себя своей карточкой: плана, вопроса, сборки. */
const CARD_TOOLS = new Set(['ask_user', 'propose_plan', 'build_deck', 'edit_slide']);

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
  const lastPart = last?.role === 'assistant' ? visibleParts(last).at(-1) : undefined;
  // Агент ещё ничего не сказал в этом ходе — ждём его, как в чатах.
  const thinking =
    !chat.error &&
    chat.activity === 'answering' &&
    running &&
    (!lastPart || (lastPart.type === 'tool' && lastPart.status === 'done'));

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
              active={message.id === last?.id && !running && !chat.recovery}
              retryable={
                message.id === last?.id && canRetryAnswer(messages) && !running && !chat.recovery
              }
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
      <ChatFeedback chat={chat} />
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
  retryable,
  active,
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
  retryable: boolean;
  active: boolean;
}) {
  const t = useTranslations('deckChat');
  const text = useMessageText();
  const parts = grouped(visibleParts(message));
  const copyText = message.parts
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n\n');
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {Array.isArray(part) ? (
            <ToolLines parts={part} messageStatus={message.status} />
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
                chatStore.approve(chatId, part.planId, outline, templateId, part.revision)
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
          ) : part.type === 'slide-edit' ? (
            <SlideEditCard key={part.editId} part={part} currentDeckId={currentDeckId} />
          ) : part.type === 'error' ? (
            <ModelErrorCard
              part={part}
              chatId={chatId}
              messageId={message.id}
              retryable={retryable}
              active={active}
              onRefine={onRefine}
            />
          ) : null}
        </Fragment>
      ))}
      {message.status === 'failed' && !message.parts.some((part) => part.type === 'error') ? (
        <ModelErrorCard
          part={{ type: 'error', message: t('status.failed') }}
          chatId={chatId}
          messageId={message.id}
          retryable={retryable}
          active={active}
          onRefine={onRefine}
        />
      ) : null}
      {message.status === 'cancelled' || message.status === 'failed' ? (
        <p className="text-xs text-muted-foreground">
          {message.status === 'cancelled' ? t('status.cancelled') : t('status.failed')}
        </p>
      ) : null}
      {message.status !== 'streaming' && copyText ? (
        <MessageActions text={copyText} always />
      ) : null}
    </>
  );
}

const READ_TOOLS = [
  'list_templates',
  'describe_template',
  'read_file',
  'research_materials',
  'read_deck',
  'read_audit',
  'search_materials',
  'inspect_template_layout',
  'preview_slide',
  'check_slide_fit',
  'check_content_coverage',
  'search_web',
  'fetch_source',
  'research_topic',
  'calculate',
  'extract_material',
  'read_table',
  'inspect_sources',
  'search_assets',
  'read_build_status',
] as const;
type ReadTool = (typeof READ_TOOLS)[number];

function isReadTool(name: string): name is ReadTool {
  return (READ_TOOLS as readonly string[]).includes(name);
}

type CardTool = 'ask_user' | 'propose_plan' | 'build_deck' | 'edit_slide';

function isCardTool(name: string): name is CardTool {
  return CARD_TOOLS.has(name);
}

/** Что агент прочитал — тихими строками, как шаги агента в Claude. */
function ToolLines({
  parts,
  messageStatus,
}: {
  parts: readonly ToolPart[];
  messageStatus: AssistantChatMessage['status'];
}) {
  const t = useTranslations('deckChat.tools');
  const reduce = useReducedMotion();
  const stateOf = (part: ToolPart) =>
    part.status === 'running' && messageStatus !== 'streaming'
      ? messageStatus === 'failed'
        ? 'failed'
        : 'cancelled'
      : part.status;
  const running = parts.findLast((part) => stateOf(part) === 'running');
  const state = running
    ? 'running'
    : parts.some((part) => stateOf(part) === 'failed')
      ? 'failed'
      : parts.some((part) => stateOf(part) === 'cancelled')
        ? 'cancelled'
        : 'done';
  const runningName = running && (isReadTool(running.name) || isCardTool(running.name));
  const summary = running
    ? runningName
      ? t(`running.${running.name as ReadTool | CardTool}`)
      : running.name
    : t(state === 'done' ? 'completed' : state === 'failed' ? 'interrupted' : 'cancelled', {
        count: parts.length,
      });
  return (
    <ThoughtLine state={state} label={summary}>
      <ul className="flex flex-col gap-1">
        {parts.map((part) => {
          const tool = isReadTool(part.name) ? part.name : null;
          const card = isCardTool(part.name) ? part.name : null;
          const partState = stateOf(part);
          const label =
            partState === 'cancelled'
              ? t('cancelledTool', { name: tool ? t(tool) : part.name })
              : partState === 'failed'
                ? t('failed', { name: tool ? t(tool) : part.name })
                : card
                  ? t(`running.${card}`)
                  : !tool
                    ? part.name
                    : part.status === 'running'
                      ? t(`running.${tool}`)
                      : t(tool);
          return (
            <motion.li
              key={part.callId}
              layout="position"
              initial={{ opacity: 0, y: reduce ? 0 : 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduce ? 0 : 0.2 }}
              className={cn(
                'flex items-center gap-2 px-1 py-1 text-[0.8125rem]',
                partState === 'failed' ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              <StatusMark status={partState} />
              <CallChip active={partState === 'running'} failed={partState === 'failed'}>
                <span className={partState === 'running' ? 'assistant-shimmer' : undefined}>
                  {label}
                </span>
              </CallChip>
            </motion.li>
          );
        })}
      </ul>
    </ThoughtLine>
  );
}
