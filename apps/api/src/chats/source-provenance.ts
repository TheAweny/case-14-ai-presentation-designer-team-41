import { isIP } from 'node:net';
import { z } from 'zod';
import type { ChatAttachment, ChatMessage } from '@lct/contracts';
import { isPublicWebAddress } from './web-address.js';
import { WEB_SOURCE_CODES } from './web-source-failure.js';

/**
 * Facts a later brief may repeat. Only a person's attachments and successful server tool
 * results count. Assistant prose and search snippets are not evidence.
 * Nothing here compares sources with each other.
 */

const MAX_JSON = 10_000;
const MAX_TEXT = 8_000;
const MAX_QUOTE = 1_000;
const MAX_URL = 2_048;

const httpUrl = z.string().min(1).max(MAX_URL).refine(publicWebUrl, 'url');

const hash = z.string().regex(/^[0-9a-fA-F]{64}$/);

const fetchSourceOutputSchema = z
  .object({
    requestedUrl: httpUrl,
    url: httpUrl,
    title: z.string().max(300).nullable(),
    text: z.string().max(MAX_TEXT),
    fetchedAt: z.string().min(1).max(40),
    contentHash: hash,
    offset: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().nullable(),
    truncated: z.boolean(),
    trust: z.literal('unverified'),
  })
  .strict();

const researchEvidenceSchema = z
  .object({
    url: httpUrl,
    title: z.string().max(300).nullable(),
    quote: z.string().min(1).max(MAX_QUOTE),
    start: z.number().int().nonnegative(),
    fetchedAt: z.string().min(1).max(40),
    contentHash: hash,
    support: z.literal('unverified'),
  })
  .strict();

const researchTopicOutputSchema = z
  .object({
    outputTruncated: z.boolean(),
    searchedQuery: z.string().max(300),
    complete: z.boolean(),
    unresponsiveEngines: z.array(z.string().max(100)).max(10),
    summary: z.string().max(4000),
    evidence: z.array(researchEvidenceSchema).max(3),
    openQuestions: z.array(z.string().max(300)).max(5),
    failures: z
      .array(
        z
          .object({
            url: z.string().max(MAX_URL),
            message: z.string().max(200),
            code: z.literal('web_source_failed').optional(),
            error: z.enum(WEB_SOURCE_CODES).optional(),
            kind: z
              .enum([
                'invalid-url',
                'blocked',
                'timeout',
                'http',
                'redirect',
                'too-large',
                'unsupported',
                'hash-mismatch',
                'unreachable',
              ])
              .optional(),
            status: z.number().int().min(100).max(599).optional(),
            retryable: z.boolean().optional(),
            action: z.enum(['try_another_source', 'retry_later', 'stop']).optional(),
          })
          .strict(),
      )
      .max(3),
    coverage: z
      .array(
        z
          .object({
            url: httpUrl,
            offset: z.number().int().nonnegative(),
            readChars: z.number().int().nonnegative(),
            truncated: z.boolean(),
            nextOffset: z.number().int().nonnegative().nullable(),
            contentHash: hash,
          })
          .strict(),
      )
      .max(3),
    manifest: z.unknown().nullable(),
  })
  .strict();

export interface UserAttachmentFact {
  readonly kind: 'user-attachment';
  readonly messageId: string;
  readonly createdAt: number;
  readonly attachment: ChatAttachment;
}

export interface FetchedSourceFact {
  readonly kind: 'fetch_source';
  readonly messageId: string;
  readonly callId: string;
  readonly url: string;
  readonly title: string | null;
  readonly text: string;
  readonly offset: number;
  readonly fetchedAt: string;
  readonly contentHash: string;
  readonly support: 'unverified';
  readonly truncated: boolean;
  readonly nextOffset: number | null;
}

export interface ResearchedSourceFact {
  readonly kind: 'research_topic';
  readonly messageId: string;
  readonly callId: string;
  readonly url: string;
  readonly title: string | null;
  readonly quote: string;
  readonly start: number;
  readonly fetchedAt: string;
  readonly contentHash: string;
  readonly support: 'unverified';
}

export type ChatSourceFact = UserAttachmentFact | FetchedSourceFact | ResearchedSourceFact;

export interface InspectedAttachment {
  readonly kind: 'user-attachment';
  readonly messageId: string;
  readonly createdAt: number;
  readonly attachmentKind: 'file' | 'template' | 'brandbook' | 'slides';
  readonly brandbookId?: string;
  readonly fileId?: string;
  readonly templateId?: string;
  readonly name: string;
  readonly slideNumber?: number;
  readonly objectCount?: number;
}

export interface InspectedFetch {
  readonly kind: 'fetch_source';
  readonly messageId: string;
  readonly callId: string;
  readonly url: string;
  readonly title: string | null;
  readonly excerpt: string;
  readonly excerptTruncated: boolean;
  readonly textChars: number;
  readonly offset: number;
  readonly fetchedAt: string;
  readonly contentHash: string;
  readonly support: 'unverified';
  readonly truncated: boolean;
  readonly nextOffset: number | null;
}

export interface InspectedResearch {
  readonly kind: 'research_topic';
  readonly messageId: string;
  readonly callId: string;
  readonly url: string;
  readonly title: string | null;
  readonly excerpt: string;
  readonly excerptTruncated: boolean;
  readonly textChars: number;
  readonly start: number;
  readonly fetchedAt: string;
  readonly contentHash: string;
  readonly support: 'unverified';
}

export type InspectedSource = InspectedAttachment | InspectedFetch | InspectedResearch;

export interface ChatSourcePage {
  readonly offset: number;
  readonly nextOffset: number | null;
  readonly assumptions: 'not-assessed';
  readonly conflicts: 'not-assessed';
  readonly items: readonly InspectedSource[];
}

export function chatSourceFacts(messages: readonly ChatMessage[]): ChatSourceFact[] {
  const facts: ChatSourceFact[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      for (const attachment of message.attachments) {
        facts.push({
          kind: 'user-attachment',
          messageId: message.id,
          createdAt: message.createdAt,
          attachment,
        });
      }
      continue;
    }
    for (const part of message.parts) {
      if (part.type !== 'tool' || part.status !== 'done' || part.output === undefined) continue;
      if (part.name === 'fetch_source') {
        const parsed = fetchSourceOutputSchema.safeParse(part.output);
        if (!parsed.success) continue;
        facts.push({
          kind: 'fetch_source',
          messageId: message.id,
          callId: part.callId,
          url: parsed.data.url,
          title: parsed.data.title,
          text: parsed.data.text,
          offset: parsed.data.offset,
          fetchedAt: parsed.data.fetchedAt,
          contentHash: parsed.data.contentHash,
          support: 'unverified',
          truncated: parsed.data.truncated,
          nextOffset: parsed.data.nextOffset,
        });
      } else if (part.name === 'research_topic') {
        const parsed = researchTopicOutputSchema.safeParse(part.output);
        if (!parsed.success) continue;
        for (const item of parsed.data.evidence) {
          facts.push({
            kind: 'research_topic',
            messageId: message.id,
            callId: part.callId,
            url: item.url,
            title: item.title,
            quote: item.quote,
            start: item.start,
            fetchedAt: item.fetchedAt,
            contentHash: item.contentHash,
            support: 'unverified',
          });
        }
      }
    }
  }
  return facts;
}

const MAX_EXCERPT = 500;
const MAX_PAGE_ITEMS = 20;

/**
 * Index of provenance. Full page text stays in chatSourceFacts for the brief.
 * Each card keeps at most 500 code points of that text, so a page always moves forward.
 */
export function inspectChatSources(
  messages: readonly ChatMessage[],
  options: { readonly offset?: number; readonly limit?: number } = {},
): ChatSourcePage {
  const facts = chatSourceFacts(messages);
  const offset = options.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > facts.length) {
    throw new Error('invalid-offset');
  }
  const limit = options.limit ?? MAX_PAGE_ITEMS;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_ITEMS)
    throw new Error('invalid-limit');
  const items: InspectedSource[] = [];
  let index = offset;
  const end = Math.min(facts.length, offset + limit);
  while (index < end) {
    const candidate = facts[index];
    if (!candidate) break;
    const card = compactFact(candidate);
    const page = pageOf([...items, card], offset, index + 1 < facts.length ? index + 1 : null);
    if (JSON.stringify(page).length >= MAX_JSON) break;
    items.push(card);
    index += 1;
  }
  if (index === offset && offset < facts.length) throw new Error('source-page-too-large');
  const nextOffset = index < facts.length ? index : null;
  const page = pageOf(items, offset, nextOffset);
  if (JSON.stringify(page).length >= MAX_JSON) throw new Error('source-page-too-large');
  return page;
}

function compactFact(fact: ChatSourceFact): InspectedSource {
  if (fact.kind === 'user-attachment') {
    const attachment = fact.attachment;
    if (attachment.kind === 'file') {
      return {
        kind: 'user-attachment',
        messageId: fact.messageId,
        createdAt: fact.createdAt,
        attachmentKind: 'file',
        fileId: attachment.fileId,
        name: attachment.name,
      };
    }
    if (attachment.kind === 'template') {
      return {
        kind: 'user-attachment',
        messageId: fact.messageId,
        createdAt: fact.createdAt,
        attachmentKind: 'template',
        templateId: attachment.templateId,
        name: attachment.name,
      };
    }
    if (attachment.kind === 'brandbook') {
      return {
        kind: 'user-attachment',
        messageId: fact.messageId,
        createdAt: fact.createdAt,
        attachmentKind: 'brandbook',
        brandbookId: attachment.brandbookId,
        name: attachment.name,
      };
    }
    return {
      kind: 'user-attachment',
      messageId: fact.messageId,
      createdAt: fact.createdAt,
      attachmentKind: 'slides',
      name: attachment.name,
      slideNumber: attachment.slideNumber,
      objectCount: attachment.elements.length,
    };
  }
  const body = fact.kind === 'fetch_source' ? fact.text : fact.quote;
  const clip = clipExcerpt(body);
  if (fact.kind === 'fetch_source') {
    return {
      kind: 'fetch_source',
      messageId: fact.messageId,
      callId: fact.callId,
      url: fact.url,
      title: fact.title,
      excerpt: clip.excerpt,
      excerptTruncated: clip.excerptTruncated,
      textChars: clip.textChars,
      offset: fact.offset,
      fetchedAt: fact.fetchedAt,
      contentHash: fact.contentHash,
      support: 'unverified',
      truncated: fact.truncated,
      nextOffset: fact.nextOffset,
    };
  }
  return {
    kind: 'research_topic',
    messageId: fact.messageId,
    callId: fact.callId,
    url: fact.url,
    title: fact.title,
    excerpt: clip.excerpt,
    excerptTruncated: clip.excerptTruncated,
    textChars: clip.textChars,
    start: fact.start,
    fetchedAt: fact.fetchedAt,
    contentHash: fact.contentHash,
    support: 'unverified',
  };
}

function clipExcerpt(value: string): {
  excerpt: string;
  excerptTruncated: boolean;
  textChars: number;
} {
  const points = Array.from(value);
  const excerpt = points.slice(0, MAX_EXCERPT).join('');
  return { excerpt, excerptTruncated: points.length > MAX_EXCERPT, textChars: points.length };
}

function pageOf(
  items: readonly InspectedSource[],
  offset: number,
  nextOffset: number | null,
): ChatSourcePage {
  return {
    offset,
    nextOffset,
    assumptions: 'not-assessed',
    conflicts: 'not-assessed',
    items,
  };
}

function publicWebUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;
  if (url.port !== '' && url.port !== '80' && url.port !== '443') return false;
  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  if (isIP(host)) return isPublicWebAddress(host);
  const name = host.toLowerCase().replace(/\.$/, '');
  if (name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local')) return false;
  return name.includes('.') && !name.includes(' ');
}
