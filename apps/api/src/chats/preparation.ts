import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  materialExtractResponseSchema,
  materialResearchInputSchema,
  materialResearchResultSchema,
  type ChatMessage,
  type ChatPart,
} from '@lct/contracts';
import { chatSourceFacts } from './source-provenance.js';

const keySchema = z
  .string()
  .min(1)
  .max(100)
  .refine((key) => key.trim().length > 0);
const evidenceSchema = z
  .object({
    messageId: z.string().min(1),
    quote: z.string().max(1000),
    callId: z.string().min(1).optional(),
    sourceId: z.string().min(1).optional(),
  })
  .strict();
const entrySchema = z
  .object({
    key: keySchema,
    // A supported question answer can contain 4,000 characters plus selected option labels.
    value: z.string().max(6000).nullable(),
    status: z.enum(['user', 'source', 'assumption', 'unknown', 'declined']),
    evidence: evidenceSchema.optional(),
  })
  .strict();

/** Local chat state, never an engine contract or a model-authored factual summary. */
export const preparationInputSchema = z.object({ entries: z.array(entrySchema).max(30) }).strict();
export type PreparationEntry = z.infer<typeof entrySchema>;
export interface Preparation {
  readonly entries: readonly PreparationEntry[];
  /** SHA256 of the canonical entries, including their provenance and non-factual statuses. */
  readonly revision: string;
}

type Tool = Extract<ChatPart, { type: 'tool' }>;
type Question = Extract<ChatPart, { type: 'question' }>;
interface Answer {
  entry: PreparationEntry;
  position: number;
}
interface Source {
  messageId: string;
  callId: string;
  sourceId: string;
  text: string;
}

const bindingSchema = z.object({ questionId: z.string().uuid(), preparationKey: keySchema });
const savedSchema = preparationInputSchema
  .extend({ revision: z.string().regex(/^[a-f0-9]{64}$/) })
  .strip();
const fileRequestSchema = z.object({ fileId: z.string().uuid() });
const pageFields = {
  name: z.string().max(300),
  text: z.string().max(8000),
  offset: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
  totalChars: z.number().int().nonnegative(),
};
const readSchema = z.object({ ...pageFields, hasMore: z.boolean() }).strict();
const extractSchema = z
  .object({
    ...pageFields,
    fileId: z.string().uuid(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    truncated: z.boolean(),
    coordinateSystem: z.literal('prepared-text-utf16'),
  })
  .strict();
const tableSchema = z
  .object({
    fileId: z.string().uuid(),
    name: z.string().max(300),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    kind: z.literal('table'),
    sheet: z.string().nullable(),
    range: z.string().nullable(),
    table: materialExtractResponseSchema.shape.table.unwrap(),
    offset: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().nullable(),
    truncated: z.boolean(),
    warnings: z.array(z.string()).max(20),
  })
  .strict();

function nonFact(text: string): 'unknown' | 'declined' | null {
  const phrase = text
    .trim()
    .toLowerCase()
    .replace(/[.!?…]+$/u, '')
    .trim();
  if (
    /^(?:не знаю|неизвестно|нет данных|не уверен(?:а)?|затрудняюсь ответить|не могу ответить|i (?:don['’]t|do not) know|unknown|not sure|no data|unsure)$/u.test(
      phrase,
    )
  )
    return 'unknown';
  if (
    /^(?:без (?:дополнительных )?вопросов|делай без вопросов|не (?:хочу|буду) отвечать|пропустить|пропусти(?: вопрос)?|отказываюсь(?: отвечать)?|skip|skip (?:this )?question|no questions|without questions|prefer not to (?:say|answer)|i (?:decline|refuse)(?: to answer)?)$/u.test(
      phrase,
    )
  )
    return 'declined';
  return null;
}

function excerpt(text: string): string {
  const end = text.length > 1000 && /[\uD800-\uDBFF]/u.test(text[999] ?? '') ? 999 : 1000;
  return text.slice(0, end);
}

function boundKey(parts: readonly ChatPart[], question: Question): string | null {
  const calls = parts.filter(
    (part): part is Tool =>
      part.type === 'tool' &&
      part.name === 'ask_user' &&
      part.status === 'done' &&
      part.callId === question.callId,
  );
  if (calls.length !== 1) return null;
  const binding = bindingSchema.safeParse(calls[0]?.output);
  return binding.success && binding.data.questionId === question.questionId
    ? binding.data.preparationKey
    : null;
}

/** Answers belong to server cards, with a binding in the same message and the same call. */
function answersOf(messages: readonly ChatMessage[]): Map<string, Answer> {
  const answers = new Map<string, Answer>();
  let position = 0;
  for (const message of messages) {
    if (message.role !== 'assistant') {
      position += 1;
      continue;
    }
    for (const part of message.parts) {
      position += 1;
      if (part.type !== 'question' || part.answer === null) continue;
      const key = boundKey(message.parts, part);
      if (key === null) continue;
      const answer = answerEntry(message.id, part, key);
      answers.set(answer.key, { entry: answer, position });
    }
  }
  return answers;
}

function answerEntry(messageId: string, part: Question, key: string): PreparationEntry {
  const answer = part.answer;
  if (!answer) throw new Error('preparation-answer-missing');
  const pieces = [...answer.optionLabels, answer.text].filter((text) => text.trim());
  const text = pieces.join('\n');
  const states = pieces.map(nonFact);
  const status = states.includes('declined')
    ? 'declined'
    : states.includes('unknown') || !text
      ? 'unknown'
      : 'user';
  return entrySchema.parse({
    key,
    value: status === 'user' ? text : null,
    status,
    ...(text ? { evidence: { messageId, callId: part.callId, quote: excerpt(text) } } : {}),
  });
}

/** Only value cells count; formulas, sheet names and warnings cannot attest a fact. */
function fileTexts(tool: Tool, files: ReadonlySet<string>): { sourceId: string; text: string }[] {
  if (tool.name === 'research_materials') {
    const request = materialResearchInputSchema.safeParse(tool.input);
    const result = materialResearchResultSchema.safeParse(tool.output);
    if (!request.success || !result.success) return [];
    return result.data.evidence.flatMap((item) => {
      if (!files.has(item.sourceId) || !request.data.fileIds.includes(item.sourceId)) return [];
      // `unverified` describes semantic support. The researcher server has checked the exact
      // substring; coverage also binds that quote to a page actually read, including partial pages.
      const covered = result.data.coverage.some(
        (page) =>
          page.sourceId === item.sourceId &&
          item.start >= (page.offset ?? 0) &&
          item.start + item.quote.length <= (page.offset ?? 0) + page.readChars,
      );
      return covered ? [{ sourceId: item.sourceId, text: item.quote }] : [];
    });
  }
  const request = fileRequestSchema.safeParse(tool.input);
  if (!request.success || !files.has(request.data.fileId)) return [];
  const sourceId = request.data.fileId;
  if (tool.name === 'read_file' || tool.name === 'extract_material') {
    const result =
      tool.name === 'read_file'
        ? readSchema.safeParse(tool.output)
        : extractSchema.safeParse(tool.output);
    if (!result.success) return [];
    const page = result.data;
    if ('fileId' in page && page.fileId !== sourceId) return [];
    const end = page.offset + page.text.length;
    const partial = 'hasMore' in page ? page.hasMore : page.truncated;
    if (
      end > page.totalChars ||
      partial !== (page.nextOffset !== null) ||
      (page.nextOffset === null
        ? end !== page.totalChars
        : page.nextOffset !== end || end >= page.totalChars)
    )
      return [];
    return [{ sourceId, text: page.text }];
  }
  if (tool.name === 'read_table') {
    const result = tableSchema.safeParse(tool.output);
    if (!result.success || result.data.fileId !== sourceId) return [];
    return result.data.table.cells.flatMap((cell) =>
      cell.value === null || (cell.formula !== null && !cell.cached)
        ? []
        : [{ sourceId, text: String(cell.value) }],
    );
  }
  return [];
}

function sourcesOf(messages: readonly ChatMessage[]): Source[] {
  const files = new Set<string>();
  const sources: Source[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      for (const attachment of message.attachments) {
        if (attachment.kind === 'file') files.add(attachment.fileId);
      }
      continue;
    }
    for (const tool of message.parts) {
      if (tool.type !== 'tool' || tool.status !== 'done') continue;
      for (const item of fileTexts(tool, files)) {
        sources.push({ messageId: message.id, callId: tool.callId, ...item });
      }
    }
  }
  // Web validation stays in the existing provenance module; search snippets and summaries
  // deliberately do not enter preparation. Web sourceId is the fetched final URL.
  for (const fact of chatSourceFacts(messages)) {
    if (fact.kind === 'fetch_source')
      sources.push({
        messageId: fact.messageId,
        callId: fact.callId,
        sourceId: fact.url,
        text: fact.text,
      });
  }
  return sources;
}

function validateEntry(
  entry: PreparationEntry,
  messages: readonly ChatMessage[],
  sources: readonly Source[],
): PreparationEntry {
  const evidence = entry.evidence;
  let user = false;
  let source = false;
  if (evidence) {
    if (!evidence.quote.trim()) throw new Error('preparation-invalid-evidence');
    const message = messages.find((item) => item.id === evidence.messageId);
    user =
      !evidence.sourceId &&
      !evidence.callId &&
      message?.role === 'user' &&
      message.text.includes(evidence.quote);
    if (!evidence.sourceId && message?.role === 'assistant' && evidence.callId !== undefined) {
      // Reconstruct the complete answer rather than searching its bounded evidence excerpt.
      const card = message.parts.find(
        (part): part is Question =>
          part.type === 'question' &&
          part.callId === evidence.callId &&
          part.answer !== null &&
          boundKey(message.parts, part) === entry.key,
      );
      const text = card?.answer
        ? [...card.answer.optionLabels, card.answer.text].filter(Boolean).join('\n')
        : '';
      user = text.includes(evidence.quote);
    }
    source = sources.some(
      (item) =>
        item.messageId === evidence.messageId &&
        item.callId === evidence.callId &&
        item.sourceId === evidence.sourceId &&
        item.text.includes(evidence.quote),
    );
    if (!user && !source) throw new Error('preparation-invalid-evidence');
  }
  if (entry.status === 'source' && !source) throw new Error('preparation-source-evidence-required');
  if (entry.status === 'user' && !user) throw new Error('preparation-user-evidence-required');
  // Explicit absence and refusal never acquire a factual value, including on replay.
  const state =
    entry.status === 'user' ? (nonFact(evidence?.quote ?? '') ?? nonFact(entry.value ?? '')) : null;
  const status = state ?? entry.status;
  if (status === 'unknown' || status === 'declined') return { ...entry, status, value: null };
  if ((status === 'user' || status === 'source') && !entry.value?.trim()) {
    throw new Error('preparation-fact-value-required');
  }
  return entry;
}

function snapshot(entries: Iterable<PreparationEntry>): Preparation {
  const sorted = [...entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (sorted.length > 30) throw new Error('preparation-too-many-entries');
  // Fixed property order survives JSON reload, even when callers reordered object properties.
  const canonical = sorted.map((entry) => ({
    key: entry.key,
    value: entry.value,
    status: entry.status,
    ...(entry.evidence
      ? {
          evidence: {
            messageId: entry.evidence.messageId,
            quote: entry.evidence.quote,
            ...(entry.evidence.callId !== undefined ? { callId: entry.evidence.callId } : {}),
            ...(entry.evidence.sourceId !== undefined ? { sourceId: entry.evidence.sourceId } : {}),
          },
        }
      : {}),
  }));
  const result = {
    entries: canonical,
    revision: createHash('sha256').update(JSON.stringify(canonical)).digest('hex'),
  };
  // Reject atomically: silently truncating would discard previously confirmed requirements.
  if (JSON.stringify(result).length > 10_000) throw new Error('preparation-too-large');
  return result;
}

/**
 * Call with the authenticated chat's persisted messages only. File attachment membership is
 * checked here; the API must also recheck current visibleFile access for each file sourceId.
 * Store this complete return value as the successful save_preparation tool output.
 */
export function buildPreparation(input: unknown, messages: readonly ChatMessage[]): Preparation {
  const patch = preparationInputSchema.parse(input);
  const current = readPreparation(messages);
  const entries = new Map(current.entries.map((entry) => [entry.key, entry]));
  const answers = answersOf(messages);
  const sources = sourcesOf(messages);
  for (const entry of patch.entries) {
    const validated = validateEntry(entry, messages, sources);
    const answer = answers.get(entry.key);
    entries.set(
      entry.key,
      answer &&
        validated.evidence &&
        answer.position >= evidencePosition(messages, validated.evidence)
        ? answer.entry
        : validated,
    );
  }
  return snapshot(entries.values());
}

/** Replay durable server outputs and answered cards; never infer facts from model arguments. */
export function readPreparation(messages: readonly ChatMessage[]): Preparation {
  const entries = new Map<string, PreparationEntry>();
  const positions = new Map<string, number>();
  const prefix: ChatMessage[] = [];
  let position = 0;
  for (const message of messages) {
    if (message.role === 'user') {
      prefix.push(message);
      position += 1;
      continue;
    }
    const parts: ChatPart[] = [];
    prefix.push({ ...message, parts });
    for (const part of message.parts) {
      position += 1;
      parts.push(part);
      if (part.type !== 'tool' || part.name !== 'save_preparation' || part.status !== 'done')
        continue;
      const saved = savedSchema.safeParse(part.output);
      if (!saved.success) continue;
      const sources = sourcesOf(prefix);
      const validated = saved.data.entries.map((entry) => validateEntry(entry, prefix, sources));
      if (snapshot(validated).revision !== saved.data.revision)
        throw new Error('preparation-revision-mismatch');
      for (const entry of validated) {
        entries.set(entry.key, entry);
        // Compare the fact's provenance with cards, not the position of a later copied snapshot.
        const origin = entry.evidence ? evidencePosition(prefix, entry.evidence) : position;
        positions.set(entry.key, origin);
      }
    }
  }
  for (const [key, answer] of answersOf(messages)) {
    if (!entries.has(key) || answer.position >= (positions.get(key) ?? -1))
      entries.set(key, answer.entry);
  }
  return snapshot(entries.values());
}

function evidencePosition(
  messages: readonly ChatMessage[],
  evidence: NonNullable<PreparationEntry['evidence']>,
): number {
  let position = 0;
  for (const message of messages) {
    if (message.role === 'user') {
      position += 1;
      if (message.id === evidence.messageId) return position;
      continue;
    }
    for (const part of message.parts) {
      position += 1;
      if (
        message.id === evidence.messageId &&
        ((part.type === 'question' && part.callId === evidence.callId) ||
          (part.type === 'tool' && part.callId === evidence.callId && part.name !== 'ask_user'))
      )
        return position;
    }
  }
  return -1;
}
