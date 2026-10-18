import { BadRequestException } from '@nestjs/common';
import type { ChatMessage, DeckOutline } from '@lct/contracts';
import { chatSourceFacts } from './source-provenance.js';

interface ExternalSourceEvidence {
  readonly kind: 'fetch_source' | 'research_topic';
  readonly url: string;
  readonly title: string | null;
  readonly quote: string;
  readonly start: number;
  readonly fetchedAt: string;
  readonly contentHash: string;
  readonly support: 'unverified';
}

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
  const externalSources = chatSourceFacts(messages).flatMap((fact): ExternalSourceEvidence[] =>
    fact.kind === 'fetch_source'
      ? [
          {
            kind: fact.kind,
            url: fact.url,
            title: fact.title,
            quote: fact.text,
            start: fact.offset,
            fetchedAt: fact.fetchedAt,
            contentHash: fact.contentHash,
            support: fact.support,
          },
        ]
      : fact.kind === 'research_topic'
        ? [
            {
              kind: fact.kind,
              url: fact.url,
              title: fact.title,
              quote: fact.quote,
              start: fact.start,
              fetchedAt: fact.fetchedAt,
              contentHash: fact.contentHash,
              support: fact.support,
            },
          ]
        : [],
  );
  if (
    !approvedOutline &&
    userRequirements.length === 0 &&
    sourceFileIds.length === 0 &&
    externalSources.length === 0
  )
    throw new BadRequestException(
      'Нужны требования пользователя или файл с исходными материалами. Уточните задачу перед сборкой.',
    );
  const brief = JSON.stringify({
    approvedOutline,
    userRequirements,
    sourceFileIds,
    externalSources,
    assumptions: 'not-assessed',
    conflicts: 'not-assessed',
  });
  if (brief.length > 60000) {
    throw new BadRequestException(
      'Требования превышают объём одной генерации. Сохраните актуальные требования в новом чате или приложите их файлом; содержание не было обрезано.',
    );
  }
  return brief;
}
