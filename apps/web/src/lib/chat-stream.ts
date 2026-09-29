import { chatEventSchema, type ChatEvent, type ChatMessage, type ChatPart } from '@lct/contracts';

/**
 * Сообщения чата после события хода. `message` кладёт сообщение целиком (новое или заменяет
 * прежнее с тем же id), `part` — одну часть ответа на её место, `text-delta` дописывает текст.
 * Остальные события сообщений не меняют.
 */
export function applyChatEvent(
  messages: readonly ChatMessage[],
  event: ChatEvent,
): readonly ChatMessage[] {
  switch (event.type) {
    case 'message': {
      const at = messages.findIndex((message) => message.id === event.message.id);
      if (at < 0) return [...messages, event.message];
      return messages.map((message, index) => (index === at ? event.message : message));
    }
    case 'part':
      return withParts(messages, event.messageId, (parts) => {
        const next = [...parts];
        next[event.index] = event.part;
        return next;
      });
    case 'text-delta':
      return withParts(messages, event.messageId, (parts) => {
        const next = [...parts];
        const current = next[event.index];
        next[event.index] = {
          type: 'text',
          text: (current?.type === 'text' ? current.text : '') + event.delta,
        };
        return next;
      });
    default:
      return messages;
  }
}

function withParts(
  messages: readonly ChatMessage[],
  messageId: string,
  change: (parts: readonly ChatPart[]) => ChatPart[],
): readonly ChatMessage[] {
  return messages.map((message) =>
    message.id === messageId && message.role === 'assistant'
      ? { ...message, parts: change(message.parts) }
      : message,
  );
}

/**
 * Прочитать поток событий хода (`text/event-stream`). Строка, которая не читается как событие,
 * пропускается: одно испорченное событие не должно обрывать ответ.
 */
export async function readChatEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const take = (line: string) => {
    if (!line.startsWith('data:')) return;
    try {
      const parsed = chatEventSchema.safeParse(JSON.parse(line.slice(5).trim()));
      if (parsed.success) onEvent(parsed.data);
    } catch {
      // Не JSON — пропускаем.
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      take(buffer.slice(0, newline).trim());
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  }
  take(buffer.trim());
}
