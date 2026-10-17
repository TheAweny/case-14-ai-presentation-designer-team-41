import { BadRequestException } from '@nestjs/common';
import type { ChatMessage, DeckOutline } from '@lct/contracts';

/** Complete factual snapshot: model summaries and drafts never become source material. */
export function generationBrief(
  messages: readonly ChatMessage[],
  outline: DeckOutline | null,
  outlineSource: 'user' | 'model',
  sourceFileIds: readonly string[],
): string {
  const userRequirements = messages.flatMap((message) =>
    message.role === 'user' && message.text.trim()
      ? [{ messageId: message.id, createdAt: message.createdAt, text: message.text }]
      : [],
  );
  const approvedOutline = outlineSource === 'user' ? outline : null;
  if (!approvedOutline && userRequirements.length === 0 && sourceFileIds.length === 0)
    throw new BadRequestException(
      'Нужны требования пользователя или файл с исходными материалами. Уточните задачу перед сборкой.',
    );
  const brief = JSON.stringify({
    approvedOutline,
    userRequirements,
    sourceFileIds,
  });
  if (brief.length > 60000) {
    throw new BadRequestException(
      'Требования превышают объём одной генерации. Сохраните актуальные требования в новом чате или приложите их файлом; содержание не было обрезано.',
    );
  }
  return brief;
}
