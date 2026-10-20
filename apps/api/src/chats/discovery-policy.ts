import type { ChatMessage, ChatPart, DeckOutline } from '@lct/contracts';
import { readPreparation } from './preparation.js';

/** An explicit opt-out survives reload; a later explicit opt-in may replace it. */
export function questionsAllowed(messages: readonly ChatMessage[]): boolean {
  let allowed = true;
  for (const message of messages) {
    if (message.role !== 'user') continue;
    if (
      /без\s+(?:дополнительных\s+|уточняющих\s+)?вопросов|не\s+задавай\s+вопрос|не\s+спрашивай|no\s+(?:more\s+)?questions|don['’]t\s+ask/iu.test(
        message.text,
      )
    )
      allowed = false;
    else if (
      /мож(?:ешь|но)\s+(?:задавать\s+вопросы|спрашивать)|задавай\s+вопросы|you\s+can\s+ask/iu.test(
        message.text,
      )
    )
      allowed = true;
  }
  return allowed;
}

/** Only prepared audience/goal influence structure. Unknowns never become slide copy. */
export function preparedOutline(
  outline: DeckOutline,
  messages: readonly ChatMessage[],
): DeckOutline {
  const entries = readPreparation(messages).entries;
  const value = (key: string) =>
    entries.find(
      (entry) => entry.key === key && (entry.status === 'user' || entry.status === 'source'),
    )?.value;
  return {
    ...outline,
    audience: value('audience') ?? outline.audience,
    goal: value('goal') ?? outline.goal,
  };
}

/** History as it stood when a particular build was persisted. */
export function beforeBuild(messages: readonly ChatMessage[], buildId: string): ChatMessage[] {
  const prefix: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role === 'assistant') {
      const index = message.parts.findIndex(
        (part) => part.type === 'build' && part.buildId === buildId,
      );
      if (index >= 0) {
        prefix.push({ ...message, parts: message.parts.slice(0, index) });
        break;
      }
    }
    prefix.push(message);
  }
  return prefix;
}

/** New builds persist an immutable revision before starting; older builds use their history. */
export function preparationRevisionForBuild(
  messages: readonly ChatMessage[],
  build: Extract<ChatPart, { type: 'build' }>,
): string {
  const message = messages.find(
    (message) =>
      message.role === 'assistant' &&
      message.parts.some(
        (part) =>
          part.type === 'build' && part.buildId === build.buildId && part.callId === build.callId,
      ),
  );
  const call =
    message?.role === 'assistant'
      ? message.parts.find(
          (part) =>
            part.type === 'tool' && part.callId === build.callId && part.name === 'build_deck',
        )
      : undefined;
  const input = call?.type === 'tool' ? call.input : null;
  const revision =
    input && typeof input === 'object' && 'preparationRevision' in input
      ? input.preparationRevision
      : null;
  return typeof revision === 'string' && /^[a-f0-9]{64}$/.test(revision)
    ? revision
    : readPreparation(beforeBuild(messages, build.buildId)).revision;
}
