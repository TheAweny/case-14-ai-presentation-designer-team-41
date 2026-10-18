import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  auditReportSchema,
  chatQuestionOptionSchema,
  deckOutlineSchema,
  storedTemplateIndexSchema,
  materialResearchInputSchema,
  materialResearchResultSchema,
  generationProfileSchema,
  type MaterialResearchSource,
  type ChatMessage,
  type ChatMode,
  type ChatPart,
  type DeckOutline,
  type LayoutVariant,
  type ModelRef,
  type ReasoningEffort,
  type FinalReview,
} from '@lct/contracts';
import type { ChatTool, ToolContext, ToolOutcome } from '@lct/pipeline';
import type { Account } from '../accounts/account-rules.js';
import { visibleFile } from '../files/template-visibility.js';
import {
  GenerationService,
  type StartedBuild,
  type VariantEnd,
} from '../generation/generation.service.js';
import { generationBrief } from './chat-brief.js';
import { calculate, calculationInputSchema } from './calculation.js';
import { readFinalReview } from './final-review.js';
import { readResearchMaterial, type MaterialResearchDependency } from './material-research.js';
import { searchMaterialFile } from './material-search.js';
import { inspectTemplateLayout } from './template-layout.js';
import { createAssetSearch, type AssetSearch } from './asset-search.js';
import { researchWebTopic } from './web-research.js';
import { materialTools } from './material-tools.js';
import { inspectionTools } from './inspection-tools.js';
import { qrTool } from './qr-tool.js';
import { inspectChatSources } from './source-provenance.js';
import { createWebSearch, webSearchBaseUrl, type WebSearch } from './web-search.js';
import { fetchWebSource, type WebSourceOptions, type WebSourcePage } from './web-source.js';
import { activityDetail, withToolActivity, type ActivityContext } from './tool-activity.js';
import { WebBudget, WebBudgetError, webBudgetOutput } from './web-budget.js';
import { WebSourceError } from './web-source.js';
import {
  isNonRetryableHttp,
  webSourceFailure,
  type WebSourceFailure,
} from './web-source-failure.js';

/** What a tool may know and change of the chat whose turn it runs in. */
export interface ChatToolScope {
  readonly account: Account;
  readonly chatId: string;
  readonly projectId: string | null;
  readonly mode: ChatMode;
  /** The model the person picked for the chat; the deck is written with it too. */
  readonly model: ModelRef | null;
  /** The thinking switch of the turn; the deck is written with it too. */
  readonly thinking?: boolean | null;
  /** The depth of thinking of the turn, for the deck as well. */
  readonly reasoningEffort?: ReasoningEffort | null;
  readonly currentMessageId?: string;
  /** The chat as it is now, the answer of this turn included. */
  messages(): readonly ChatMessage[];
  /** Replace a part of an earlier message: a plan superseded or approved. */
  updatePart(messageId: string, index: number, part: ChatPart): void;
  /** Decks the chat produced, and the one it leads to. */
  addDecks(deckIds: readonly string[], primary: string | null): void;
  /** Persist operation intent and confirm the execution lease before a side effect. */
  persist?(): Promise<void>;
}

type BuildPart = Extract<ChatPart, { type: 'build' }>;

/** A plan of the chat with where it is, so it can be replaced in place. */
function plansOf(messages: readonly ChatMessage[]) {
  return messages.flatMap((message) =>
    message.role === 'assistant'
      ? message.parts.flatMap((part, index) =>
          part.type === 'plan' ? [{ messageId: message.id, index, part }] : [],
        )
      : [],
  );
}

/** Decks built in the chat, by the result parts of its builds. */
export function chatDecks(messages: readonly ChatMessage[]): Set<string> {
  return new Set(
    messages.flatMap((message) =>
      message.role === 'assistant'
        ? message.parts.flatMap((part) =>
            part.type === 'result' ? part.variants.map((variant) => variant.deckId) : [],
          )
        : [],
    ),
  );
}

/**
 * The object of a deck the person attached from the editor, as it was when they sent it: the
 * latest attachment of that slide that names it. The agent edits only what it was shown.
 */
export function pointedElement(
  messages: readonly ChatMessage[],
  target: { deckId: string; slideNumber: number; elementId: string },
): { kind: string; text: string } | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'user') continue;
    for (const attachment of message.attachments) {
      if (
        attachment.kind !== 'slides' ||
        attachment.deckId !== target.deckId ||
        attachment.slideNumber !== target.slideNumber
      )
        continue;
      const element = attachment.elements.find((item) => item.elementId === target.elementId);
      if (element) return { kind: element.kind, text: element.text };
    }
  }
  return null;
}

/** Order the agent recommends variants in when their audit is equal. */
const PREFERENCE: readonly LayoutVariant[] = ['balanced', 'dense', 'airy'];

interface VariantOutcome {
  readonly variant: LayoutVariant;
  readonly deckId: string;
  readonly errors: number | null;
  readonly warnings: number | null;
  readonly review?: FinalReview;
}

/** Fewer errors first, then fewer warnings, then the balanced one. */
export function recommend(variants: readonly VariantOutcome[]): LayoutVariant {
  const audited = variants.every((variant) => variant.errors !== null && variant.warnings !== null);
  const best = [...variants].sort(
    (a, b) =>
      (audited ? (a.errors ?? 0) - (b.errors ?? 0) || (a.warnings ?? 0) - (b.warnings ?? 0) : 0) ||
      PREFERENCE.indexOf(a.variant) - PREFERENCE.indexOf(b.variant),
  )[0];
  if (!best) throw new Error('No variants to recommend.');
  return best.variant;
}

const TEXT_FILE = /\.(txt|md|csv|tsv)$/i;
const MAX_FILE_CHARS = 8000;
const MAX_SEARCH_CALLS = 8;

function attachedFileIds(scope: ChatToolScope): Set<string> {
  return new Set(
    scope
      .messages()
      .flatMap((message) =>
        message.role === 'user'
          ? message.attachments.flatMap((item) => (item.kind === 'file' ? [item.fileId] : []))
          : [],
      ),
  );
}

/** Test double for the public web. Production builds it from WEB_SEARCH_URL and fetchWebSource. */
export interface ChatWebDependency {
  readonly search: WebSearch | null;
  readonly fetchSource: (
    url: string,
    signal: AbortSignal,
    options?: WebSourceOptions,
  ) => Promise<WebSourcePage>;
  /** Material researcher for one later isolated step. It does not call a model of its own. */
  readonly research?: MaterialResearchDependency;
  /** Image leads. Production builds this from WEB_SEARCH_URL when no web dependency is passed. */
  readonly assets?: AssetSearch;
}

/**
 * The tools of the chat agent for one turn. They read and build through the same services as the
 * generation endpoints, and see only what the account may use.
 */
export function chatTools(
  generation: GenerationService,
  scope: ChatToolScope,
  research?: MaterialResearchDependency,
  web?: ChatWebDependency,
): ChatTool[] {
  const { pool } = generation;
  const account = scope.account;
  let researchCalls = 0;
  let searchCalls = 0;
  const searchCache = new Map<string, unknown>();
  const webBudget = new WebBudget();
  let researchTopicCalls = 0;
  const researchTopicCache = new Map<string, unknown>();
  const baseUrl = web ? null : webSearchBaseUrl(process.env);
  let searchClient: WebSearch | null = null;
  let assetClient: AssetSearch | null = null;
  if (web) {
    searchClient = web.search;
    assetClient = web.assets ?? null;
  } else if (baseUrl !== null) {
    try {
      searchClient = createWebSearch({ baseUrl });
    } catch {
      searchClient = null;
    }
    try {
      assetClient = createAssetSearch({ baseUrl });
    } catch {
      assetClient = null;
    }
  }
  if (web && assetClient === null) {
    const assetBase = webSearchBaseUrl(process.env);
    if (assetBase !== null) {
      try {
        assetClient = createAssetSearch({ baseUrl: assetBase });
      } catch {
        assetClient = null;
      }
    }
  }
  const fetchSource = web?.fetchSource ?? fetchWebSource;
  const deniedFetches = new Map<string, WebSourceFailure>();

  function throwIfDenied(url: string, signal: AbortSignal): void {
    signal.throwIfAborted();
    const key = deniedPageKey(url);
    if (key === null) return;
    const denied = deniedFetches.get(key);
    if (denied) throw new StoredWebSourceFailure(denied);
  }

  async function readPublicPage(
    url: string,
    signal: AbortSignal,
    options?: WebSourceOptions,
  ): Promise<WebSourcePage> {
    signal.throwIfAborted();
    const key = deniedPageKey(url);
    if (key !== null) {
      const denied = deniedFetches.get(key);
      if (denied) throw new StoredWebSourceFailure(denied);
    }
    try {
      return await fetchSource(url, signal, options);
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof WebSourceError && error.kind === 'aborted') throw error;
      if (error instanceof Error && error.name === 'AbortError') throw error;
      if (!(error instanceof WebSourceError)) {
        throw new StoredWebSourceFailure(webSourceFailure(new WebSourceError('unreachable')));
      }
      const failure = webSourceFailure(error);
      if (key !== null && isNonRetryableHttp(failure.status)) deniedFetches.set(key, failure);
      throw new StoredWebSourceFailure(failure);
    }
  }

  async function webCall<T>(key: string, signal: AbortSignal, load: () => Promise<T>): Promise<T> {
    const operation = key.startsWith('assets:')
      ? 'images'
      : key.startsWith('fetch:')
        ? 'fetch'
        : 'search';
    return webBudget.call(operation, key, signal, load);
  }

  const researchMaterials: ChatTool = {
    name: 'research_materials',
    input: materialResearchInputSchema,
    modes: ['chat', 'plan', 'auto'],
    async run(input, context) {
      context.signal.throwIfAborted();
      if (!research) throw new Error('Material research is unavailable.');
      if (researchCalls >= 2)
        throw new Error('The material research call limit for this turn was reached.');
      researchCalls += 1;
      const request = materialResearchInputSchema.parse(input);
      const attached = attachedFileIds(scope);
      if (request.fileIds.some((id) => !attached.has(id))) {
        throw new Error('Research may read only materials attached by the person in this chat.');
      }
      const sources: MaterialResearchSource[] = [];
      for (const fileId of new Set(request.fileIds)) {
        context.signal.throwIfAborted();
        const result = await pool.query<{ file_name: string; storage_path: string }>(
          `SELECT file_name, storage_path FROM stored_files
           WHERE id = $1 AND kind = 'content' AND ${visibleFile(2)}`,
          [fileId, account.id],
        );
        const row = result.rows[0];
        if (!row) throw new Error('There is no such material available to this account.');
        sources.push(
          await readResearchMaterial(
            fileId,
            row.file_name,
            row.storage_path,
            context.signal,
            request.offsets?.[fileId] ?? 0,
          ),
        );
      }
      const output = materialResearchResultSchema.parse(
        await withToolActivity(
          context,
          {
            kind: 'agent',
            name: 'material-researcher',
            detail: activityDetail(request.question, 'question'),
            parentId: context.callId,
          },
          () => research.run(request.question, sources, context.signal),
        ),
      );
      context.signal.throwIfAborted();
      return { output };
    },
  };

  const templateRow = async (templateId: string) => {
    const result = await pool.query<{
      id: string;
      name: string;
      profile: {
        generation?: unknown;
        index?: unknown;
        designSystem?: { palette?: { role?: string; hex?: string }[] };
      } | null;
    }>(
      `SELECT id, COALESCE(display_name, file_name) AS name, profile FROM stored_files
       WHERE id = $1 AND kind = 'template' AND ${visibleFile(2)}`,
      [templateId, account.id],
    );
    const row = result.rows[0];
    if (!row) throw new Error('There is no such template in the library.');
    return row;
  };

  const layoutKinds = (index: unknown) => {
    const parsed = storedTemplateIndexSchema.safeParse(index);
    if (!parsed.success) return null;
    const kinds: Record<string, number> = {};
    for (const note of parsed.data.notes) {
      if (!note.skip) kinds[note.kind] = (kinds[note.kind] ?? 0) + 1;
    }
    return kinds;
  };

  const chatDeck = async (deckId: string) => {
    if (
      !chatDecks(scope.messages()).has(deckId) ||
      !(await generation.library.visible(deckId, account.id))
    )
      throw new Error('This deck was not built in this chat.');
    return generation.directory(deckId);
  };

  const auditOf = async (deckId: string) => {
    const report = auditReportSchema.parse(
      JSON.parse(
        await readFile(join(generation.directory(deckId), 'audit-deterministic.json'), 'utf8'),
      ),
    );
    const review = await readFinalReview(generation.directory(deckId));
    return { report, review, errors: review?.errors ?? null, warnings: review?.warnings ?? null };
  };

  const listTemplates: ChatTool = {
    name: 'list_templates',
    input: z.object({}),
    modes: ['chat', 'plan', 'auto'],
    async run() {
      const result = await pool.query<{
        id: string;
        name: string;
        profile: { generation?: unknown; index?: unknown } | null;
        attached: boolean;
      }>(
        `SELECT f.id, COALESCE(f.display_name, f.file_name) AS name, f.profile,
                EXISTS (SELECT 1 FROM library_project_templates t
                        WHERE t.template_id = f.id AND t.project_id = $2) AS attached
         FROM stored_files f
         WHERE f.kind = 'template' AND ${visibleFile(1, 'f')}
         ORDER BY attached DESC, f.created_at DESC LIMIT 40`,
        [account.id, scope.projectId],
      );
      return {
        output: {
          templates: result.rows.map((row) => ({
            templateId: row.id,
            name: row.name,
            attachedToProject: row.attached,
            layoutsByKind: layoutKinds(row.profile?.index),
          })),
        },
      };
    },
  };

  const describeTemplate: ChatTool = {
    name: 'describe_template',
    input: z.object({ templateId: z.string().uuid() }),
    modes: ['chat', 'plan', 'auto'],
    async run(input) {
      const { templateId } = input as { templateId: string };
      const row = await templateRow(templateId);
      const index = storedTemplateIndexSchema.safeParse(row.profile?.index);
      const generationProfile = generationProfileSchema.safeParse(row.profile?.generation);
      const layouts = index.success
        ? index.data.notes
            .filter((note) => !note.skip)
            .map((note) => ({
              patternId: note.patternId,
              kind: note.kind,
              title: note.title,
              useFor: note.useFor,
              items: note.items,
              ...(note.special ? { special: true } : {}),
              ...(note.requiredContent.length ? { requiredContent: note.requiredContent } : {}),
            }))
        : generationProfile.success
          ? generationProfile.data.compositions.map((composition) => ({
              patternId: composition.patternId,
              sourceIndex: composition.sourceIndex,
            }))
          : null;
      return {
        output: {
          templateId,
          name: row.name,
          colors: (row.profile?.designSystem?.palette ?? [])
            .slice(0, 10)
            .map((entry) => ({ role: entry.role, hex: entry.hex })),
          layouts,
          ...(layouts
            ? {}
            : { note: 'The template is not prepared yet: it is when a deck is built.' }),
        },
      };
    },
  };

  const readFileTool: ChatTool = {
    name: 'read_file',
    input: z.object({
      fileId: z.string().uuid(),
      offset: z.number().int().nonnegative().default(0),
      limit: z.number().int().positive().max(MAX_FILE_CHARS).default(MAX_FILE_CHARS),
    }),
    modes: ['chat', 'plan', 'auto'],
    async run(input) {
      const {
        fileId,
        offset = 0,
        limit = MAX_FILE_CHARS,
      } = input as { fileId: string; offset?: number; limit?: number };
      if (!attachedFileIds(scope).has(fileId)) {
        throw new Error('Read may use only materials attached by the person in this chat.');
      }
      const result = await pool.query<{ file_name: string; storage_path: string }>(
        `SELECT file_name, storage_path FROM stored_files
         WHERE id = $1 AND kind = 'content' AND ${visibleFile(2)}`,
        [fileId, account.id],
      );
      const row = result.rows[0];
      if (!row) throw new Error('There is no such file.');
      if (!TEXT_FILE.test(row.storage_path))
        throw new Error('Only text, Markdown and CSV/TSV files can be read.');
      const text = await readFile(row.storage_path, 'utf8');
      return {
        output: {
          name: row.file_name,
          text: text.slice(offset, offset + limit),
          offset,
          nextOffset: offset + limit < text.length ? offset + limit : null,
          hasMore: offset + limit < text.length,
          totalChars: text.length,
        },
      };
    },
  };

  const searchInput = z.object({
    fileId: z.string().uuid(),
    query: z.string().trim().min(1).max(200),
    offset: z.number().int().min(0).max(2_000_000).default(0),
    limit: z.number().int().min(1).max(10).default(5),
  });
  const searchMaterials: ChatTool = {
    name: 'search_materials',
    input: searchInput,
    modes: ['chat', 'plan', 'auto'],
    async run(input, context) {
      context.signal.throwIfAborted();
      const request = searchInput.parse(input);
      const key = JSON.stringify([request.fileId, request.query, request.offset, request.limit]);
      const cached = searchCache.get(key);
      if (cached) return { output: cached };
      if (searchCalls >= MAX_SEARCH_CALLS) {
        throw new Error('The material search call limit for this turn was reached.');
      }
      if (!attachedFileIds(scope).has(request.fileId)) {
        throw new Error('Search may read only materials attached by the person in this chat.');
      }
      searchCalls += 1;
      const found = await pool.query<{ file_name: string; storage_path: string }>(
        "SELECT file_name, storage_path FROM stored_files WHERE id = $1 AND kind = 'content' AND " +
          visibleFile(2),
        [request.fileId, account.id],
      );
      const stored = found.rows[0];
      if (!stored) throw new Error('There is no such material available to this account.');
      context.signal.throwIfAborted();
      const output = await searchMaterialFile({
        sourceId: request.fileId,
        name: stored.file_name,
        path: stored.storage_path,
        query: request.query,
        offset: request.offset,
        limit: request.limit,
        signal: context.signal,
      });
      context.signal.throwIfAborted();
      searchCache.set(key, output);
      return { output };
    },
  };

  const inspectInput = z.object({
    templateId: z.string().uuid(),
    patternId: z.string().trim().min(1).max(200),
    offset: z.number().int().nonnegative().default(0),
    imageOffset: z.number().int().nonnegative().default(0),
  });
  const inspectTemplate: ChatTool = {
    name: 'inspect_template_layout',
    input: inspectInput,
    modes: ['chat', 'plan', 'auto'],
    async run(input, context) {
      context.signal.throwIfAborted();
      const request = inspectInput.parse(input);
      let row = await templateRow(request.templateId);
      if (!generationProfileSchema.safeParse(row.profile?.generation).success) {
        context.signal.throwIfAborted();
        await generation.prepare(request.templateId, scope.model, account);
        context.signal.throwIfAborted();
        row = await templateRow(request.templateId);
      }
      return {
        output: inspectTemplateLayout(
          row.profile?.generation,
          row.profile?.index,
          request.patternId,
          request.offset,
          request.imageOffset,
        ),
      };
    },
  };

  const calculateTool: ChatTool = {
    name: 'calculate',
    input: calculationInputSchema,
    modes: ['chat', 'plan', 'auto'],
    async run(input) {
      return { output: calculate(input) };
    },
  };

  const searchWebInput = z.object({
    query: z.string().trim().min(1).max(300),
    limit: z.number().int().min(1).max(8).default(5),
  });
  const searchWeb: ChatTool = {
    name: 'search_web',
    input: searchWebInput,
    modes: ['chat', 'plan', 'auto'],
    async run(input, context) {
      context.signal.throwIfAborted();
      const request = searchWebInput.parse(input);
      if (!searchClient) throw new Error('Web search is unavailable.');
      const output = await webCall(
        'search:' + request.query + ':' + String(request.limit),
        context.signal,
        () => searchClient.search(request.query, context.signal, request.limit),
      );
      return { output };
    },
  };

  const fetchSourceInput = z.object({
    url: z.string().trim().min(1).max(2048),
    offset: z.number().int().min(0).default(0),
    maxChars: z.number().int().min(1).max(8000).default(8000),
    expectedContentHash: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/)
      .optional(),
  });
  const fetchSourceTool: ChatTool = {
    name: 'fetch_source',
    input: fetchSourceInput,
    modes: ['chat', 'plan', 'auto'],
    async run(input, context) {
      context.signal.throwIfAborted();
      const request = fetchSourceInput.parse(input);
      throwIfDenied(request.url, context.signal);
      const output = await webCall(
        'fetch:' +
          request.url +
          ':' +
          String(request.offset) +
          ':' +
          String(request.maxChars) +
          ':' +
          (request.expectedContentHash ?? ''),
        context.signal,
        () =>
          readPublicPage(request.url, context.signal, {
            offset: request.offset,
            maxChars: request.maxChars,
            ...(request.expectedContentHash
              ? { expectedContentHash: request.expectedContentHash }
              : {}),
          }),
      );
      return { output };
    },
  };

  const researchTopicInput = z.object({
    question: z.string().trim().min(1).max(1000),
  });
  const researchTopic: ChatTool = {
    name: 'research_topic',
    input: researchTopicInput,
    modes: ['chat', 'plan', 'auto'],
    async run(input, context) {
      context.signal.throwIfAborted();
      const request = researchTopicInput.parse(input);
      const researcher = web?.research;
      if (!searchClient || !researcher) throw new Error('Web research is unavailable.');
      const client = searchClient;
      const cached = researchTopicCache.get(request.question);
      if (cached !== undefined) return { output: cached };
      webBudget.reserveResearch(researchTopicCalls);
      researchTopicCalls += 1;
      const output = await researchWebTopic(
        request.question,
        {
          search: (query, signal, limit) =>
            webCall('search:' + query + ':' + String(limit), signal, () =>
              withToolActivity(
                context,
                {
                  kind: 'tool',
                  name: 'search_web',
                  detail: activityDetail(query, 'question'),
                  parentId: context.callId,
                },
                () => client.search(query, signal, limit),
              ),
            ),
          fetch: (url, signal) =>
            withToolActivity(
              context,
              {
                kind: 'tool',
                name: 'fetch_source',
                ...urlDetail(url),
                parentId: context.callId,
              },
              async () => {
                throwIfDenied(url, signal);
                return webCall('fetch:' + url + ':0:8000:', signal, () =>
                  readPublicPage(url, signal, { offset: 0, maxChars: 8000 }),
                );
              },
            ),
          run: (question, sources, signal) =>
            withToolActivity(
              context,
              {
                kind: 'agent',
                name: 'web-researcher',
                detail: activityDetail(question, 'question'),
                parentId: context.callId,
              },
              () => researcher.run(question, sources, signal),
            ),
        },
        context.signal,
      );
      researchTopicCache.set(request.question, output);
      return { output };
    },
  };

  const searchAssetsInput = z.object({
    query: z.string().trim().min(1).max(300),
    limit: z.number().int().min(1).max(5).default(5),
  });
  const searchAssets: ChatTool = {
    name: 'search_assets',
    input: searchAssetsInput,
    modes: ['chat', 'plan', 'auto'],
    async run(input, context) {
      context.signal.throwIfAborted();
      const request = searchAssetsInput.parse(input);
      const assets = assetClient;
      if (!assets) throw new Error('Asset search is unavailable.');
      const output = await webCall(
        'assets:' + request.query + ':' + String(request.limit),
        context.signal,
        () => assets.search(request.query, context.signal, request.limit),
      );
      return { output };
    },
  };

  const inspectSourcesInput = z.object({
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(20).default(10),
  });
  const inspectSources: ChatTool = {
    name: 'inspect_sources',
    input: inspectSourcesInput,
    modes: ['chat', 'plan', 'auto'],
    async run(input, context) {
      context.signal.throwIfAborted();
      const request = inspectSourcesInput.parse(input);
      return { output: inspectChatSources(scope.messages(), request) };
    },
  };

  const readDeck: ChatTool = {
    name: 'read_deck',
    input: z.object({ deckId: z.string() }),
    modes: ['chat', 'plan', 'auto'],
    async run(input) {
      const directory = await chatDeck((input as { deckId: string }).deckId);
      const written = z
        .array(
          z.object({
            index: z.number(),
            title: z.string().optional(),
            slide: z.object({ texts: z.array(z.object({ text: z.string() })) }),
          }),
        )
        .parse(JSON.parse(await readFile(join(directory, 'plan.json'), 'utf8')));
      return {
        output: {
          title: written[0]?.title ?? '',
          slides: written
            .sort((a, b) => a.index - b.index)
            .map((slide) => ({
              slide: slide.index + 1,
              texts: slide.slide.texts.map((text) => text.text).filter(Boolean),
            })),
        },
      };
    },
  };

  const readAudit: ChatTool = {
    name: 'read_audit',
    input: z.object({ deckId: z.string() }),
    modes: ['chat', 'plan', 'auto'],
    async run(input) {
      const deckId = (input as { deckId: string }).deckId;
      await chatDeck(deckId);
      const { report, review, errors, warnings } = await auditOf(deckId);
      return {
        output: {
          errors,
          warnings,
          auditAvailable: review !== null,
          status: review?.status ?? 'unknown',
          contentRevision: review?.contentRevision ?? null,
          contentHash: review?.contentHash ?? null,
          coverage: review?.coverage ?? null,
          contextual: review?.issues ?? null,
          findings: report.findings.slice(0, 40).map((finding) => ({
            slide: finding.target.slideId,
            severity: finding.severity,
            title: finding.title,
          })),
        },
      };
    },
  };

  const askUser: ChatTool = {
    name: 'ask_user',
    input: z.object({
      question: z.string().trim().min(1).max(500),
      options: z.array(chatQuestionOptionSchema).max(6).default([]),
      multiSelect: z.boolean().default(false),
    }),
    modes: ['plan', 'auto'],
    async run(input, context) {
      const question = input as {
        question: string;
        options: { label: string; description: string }[];
        multiSelect: boolean;
      };
      const questionId = crypto.randomUUID();
      context.show({
        type: 'question',
        callId: context.callId,
        questionId,
        question: question.question,
        options: question.options,
        multiSelect: question.multiSelect,
        answer: null,
      });
      return {
        output: { questionId, status: 'Asked. The answer comes as the next message.' },
        stop: true,
      };
    },
  };

  const proposePlan: ChatTool = {
    name: 'propose_plan',
    input: z.object({
      outline: deckOutlineSchema,
      templateId: z.string().uuid().nullable().default(null),
    }),
    modes: ['plan', 'auto'],
    async run(input, context) {
      const { outline, templateId } = input as { outline: DeckOutline; templateId: string | null };
      if (templateId !== null) await templateRow(templateId);
      for (const plan of plansOf(scope.messages())) {
        if (plan.part.status === 'proposed')
          scope.updatePart(plan.messageId, plan.index, { ...plan.part, status: 'superseded' });
      }
      const planId = crypto.randomUUID();
      context.show({
        type: 'plan',
        callId: context.callId,
        planId,
        revision: 1,
        outline,
        templateId,
        status: 'proposed',
      });
      return scope.mode === 'plan'
        ? {
            output: {
              planId,
              status: 'Shown to the person. The turn waits for their approval or edits.',
            },
            stop: true,
          }
        : { output: { planId, status: 'Shown. Build it now with build_deck.' } };
    },
  };

  const buildDeck: ChatTool = {
    name: 'build_deck',
    input: z.object({
      templateId: z.string().uuid(),
      planId: z.string().uuid().nullable().default(null),
      brief: z.string().trim().max(8000).default(''),
      fileIds: z.array(z.string().uuid()).max(10).default([]),
      retry: z.boolean().default(false),
    }),
    modes: ['plan', 'auto'],
    async run(input, context) {
      const request = input as {
        templateId: string;
        planId: string | null;
        brief: string;
        fileIds: string[];
        retry: boolean;
      };
      const plan = plansOf(scope.messages()).find((item) => item.part.planId === request.planId);
      if (scope.mode === 'plan') {
        if (!plan)
          throw new Error('In the plan mode a deck is built only from a plan: propose one.');
        if (plan.part.status !== 'approved')
          throw new Error('This plan is not approved. Wait for the person to approve it.');
      }
      if (request.planId !== null && !plan) throw new Error('There is no plan with this planId.');
      if (plan?.part.status === 'superseded')
        throw new Error('This plan was replaced by a newer one.');
      if (plan?.part.status === 'approved' && plan.part.templateId !== request.templateId)
        throw new Error(
          'The template of an approved revision cannot be changed. Approve a new revision.',
        );
      if (plan && plan.part.status !== 'approved')
        scope.updatePart(plan.messageId, plan.index, {
          ...plan.part,
          templateId: request.templateId,
          status: 'approved',
          approvalSource: 'model',
        });
      // A model may list the template among the materials; as content it would fail the build.
      const templates = new Set([
        request.templateId,
        ...scope
          .messages()
          .flatMap((message) =>
            message.role === 'user'
              ? message.attachments.flatMap((item) =>
                  item.kind === 'template' ? [item.templateId] : [],
                )
              : [],
          ),
      ]);
      return runBuild(generation, scope, context, {
        templateId: request.templateId,
        planId: plan?.part.planId ?? null,
        planRevision: plan?.part.revision ?? (plan ? 1 : null),
        outline: plan?.part.outline ?? null,
        outlineSource: plan?.part.approvalSource === 'user' ? 'user' : 'model',
        brief: request.brief,
        fileIds: request.fileIds.filter((id) => !templates.has(id)),
        retry: request.retry,
      });
    },
  };

  const editSlide: ChatTool = {
    name: 'edit_slide',
    input: z.object({
      deckId: z.string().min(1).max(100),
      slideNumber: z.number().int().positive(),
      elementId: z.string().min(1).max(100),
      text: z.string().max(4000),
    }),
    modes: ['chat', 'plan', 'auto'],
    async run(input, context) {
      const edit = input as {
        deckId: string;
        slideNumber: number;
        elementId: string;
        text: string;
      };
      const pointed = pointedElement(scope.messages(), edit);
      if (!pointed)
        throw new Error(
          'The person has not pointed at this object: only objects attached from the editor ' +
            'can be edited. Ask them to select it on the slide and attach it to the message.',
        );
      if (pointed.kind !== 'text')
        throw new Error('Only the text of a text object can be changed with edit_slide.');
      const editId = crypto.randomUUID();
      context.show({
        type: 'slide-edit',
        callId: context.callId,
        editId,
        deckId: edit.deckId,
        slideNumber: edit.slideNumber,
        elementId: edit.elementId,
        before: pointed.text,
        text: edit.text,
      });
      return {
        output: {
          editId,
          status:
            'Sent to the editor: it writes the text into the draft, where the person sees it and ' +
            'can undo it.',
        },
      };
    },
  };

  return [
    qrTool(scope),
    listTemplates,
    describeTemplate,
    inspectTemplate,
    readFileTool,
    ...(attachedFileIds(scope).size > 0 ? [searchMaterials] : []),
    ...(research ? [researchMaterials] : []),
    ...materialTools(generation, scope),
    calculateTool,
    ...(searchClient ? [searchWeb] : []),
    ...(searchClient && web?.research ? [researchTopic] : []),
    ...(assetClient ? [searchAssets] : []),
    fetchSourceTool,
    inspectSources,
    readDeck,
    readAudit,
    ...inspectionTools(generation, scope),
    askUser,
    proposePlan,
    buildDeck,
    editSlide,
  ]
    .filter((tool) => tool.modes.includes(scope.mode))
    .map((tool): ChatTool => ({
      ...tool,
      async run(input, context) {
        try {
          return await tool.run(input, context);
        } catch (error) {
          context.signal.throwIfAborted();
          if (error instanceof WebBudgetError)
            return { failed: true, output: webBudgetOutput(error) };
          if (error instanceof StoredWebSourceFailure)
            return { failed: true, output: error.failure };
          throw error;
        }
      },
    }));
}

function activityOf(context: ToolContext): ActivityContext['activity'] {
  const activity = (context as ActivityContext).activity;
  return typeof activity === 'function' ? activity : undefined;
}

function urlDetail(url: string): { detail?: string } {
  const detail = activityDetail(url, 'url');
  return detail ? { detail } : {};
}

/**
 * Identity of one public page for this turn. Query strings stay distinct because they can name
 * different resources. Fragments do not. Invalid URLs, credentials and nonstandard ports are
 * excluded so these requests still go through the original address validation.
 */
export function deniedPageKey(url: string): string | null {
  if (typeof url !== 'string' || url.length > 2048) return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.href.length > 2048) return null;
    if (parsed.username !== '' || parsed.password !== '') return null;
    const defaultPort = parsed.protocol === 'http:' ? '80' : '443';
    if (parsed.port !== '' && parsed.port !== defaultPort) return null;
    parsed.hash = '';
    if (parsed.pathname === '') parsed.pathname = '/';
    return parsed.toString();
  } catch {
    return null;
  }
}

/** A mapped fetch failure. The model output is the whitelist object, never the raw error. */
class StoredWebSourceFailure extends Error {
  override readonly name = 'StoredWebSourceFailure';

  constructor(readonly failure: WebSourceFailure) {
    super(failure.error);
    this.output = failure;
  }

  readonly output: WebSourceFailure;
}

/**
 * Build a deck and wait for it: prepare the template if it has not been, start the three
 * variants, follow them in a build part, and put their result into the chat. Stopping the turn
 * stops the build.
 */
export async function runBuild(
  generation: GenerationService,
  scope: ChatToolScope,
  context: ToolContext,
  request: {
    templateId: string;
    outline: DeckOutline | null;
    outlineSource?: 'user' | 'model';
    brief: string;
    fileIds: readonly string[];
    planId?: string | null;
    planRevision?: number | null;
    retry?: boolean;
  },
): Promise<ToolOutcome> {
  if (request.planId) {
    const messages = scope.messages();
    const parts = messages.flatMap((message) =>
      message.role === 'assistant' ? message.parts : [],
    );
    const existing = [...parts]
      .reverse()
      .find(
        (part): part is BuildPart =>
          part.type === 'build' &&
          part.planId === request.planId &&
          part.planRevision === request.planRevision,
      );
    if (existing) {
      if (existing.templateId !== request.templateId)
        throw new Error(
          'The template of this build operation has changed. Approve a new revision.',
        );
      const result = parts.find(
        (part) => part.type === 'result' && part.buildId === existing.buildId,
      );
      if (existing.status === 'done' && result?.type === 'result') {
        return {
          output: {
            status: 'done',
            reused: true,
            variants: result.variants,
            recommended: result.recommended,
          },
        };
      }
      if (existing.status === 'preparing' || existing.status === 'running') {
        context.show({
          type: 'text',
          text: 'Сборка ещё выполняется. Её ход показан в карточке сборки.',
        });
        return {
          output: {
            status: existing.status,
            active: true,
            reused: true,
            buildId: existing.buildId,
            runId: existing.runId,
          },
          stop: true,
        };
      }
      const terminalFailure = existing.status === 'failed' || existing.status === 'cancelled';
      const fromCurrentTurn = messages.some(
        (message) =>
          message.role === 'assistant' &&
          message.id === scope.currentMessageId &&
          message.parts.includes(existing),
      );
      if (!terminalFailure || !request.retry || fromCurrentTurn) {
        const message = terminalFailure
          ? buildFailureMessage(existing.error)
          : 'Состояние результата сборки неизвестно. Проверьте библиотеку перед повторным запуском.';
        context.show({ type: 'error', message });
        return {
          output: {
            status: terminalFailure ? existing.status : 'unknown',
            active: false,
            buildId: existing.buildId,
            runId: existing.runId,
            error: existing.error,
            canRetry: terminalFailure && !fromCurrentTurn,
          },
          failed: true,
          stop: true,
        };
      }
    }
  }
  const template = await generation.template(request.templateId, scope.account);
  const startedAt = Date.now();
  let part: BuildPart = {
    type: 'build',
    callId: context.callId,
    buildId: crypto.randomUUID(),
    planId: request.planId ?? null,
    planRevision: request.planRevision ?? null,
    templateId: request.templateId,
    templateName: template.file_name,
    runId: null,
    variantRunIds: [],
    startedAt,
    finishedAt: null,
    status: 'preparing',
    error: null,
  };
  const outlineSource = request.outlineSource ?? 'model';
  const brief = generationBrief(scope.messages(), request.outline, outlineSource, request.fileIds);
  const index = context.show(part);
  const set = (patch: Partial<BuildPart>) => {
    part = { ...part, ...patch };
    context.update(index, part);
  };
  let startedRunId: string | null = null;
  let detachAbort: () => void = () => undefined;
  let persistenceFailed = false;
  const persist = async () => {
    try {
      await scope.persist?.();
    } catch (error) {
      persistenceFailed = true;
      throw error;
    }
  };
  try {
    context.signal.throwIfAborted();
    await persist();
    if (!GenerationService.prepared(template)) {
      await generation.prepare(request.templateId, scope.model, scope.account);
      context.signal.throwIfAborted();
    }
    context.signal.throwIfAborted();
    await persist();
    const generationInput = {
      templateId: request.templateId,
      brief,
      slideCount: null as null,
      outline: request.outline,
      outlineSource,
      projectId: scope.projectId,
      contentIds: [...request.fileIds],
      seed: 42,
      model: scope.model,
      thinking: scope.thinking ?? null,
      reasoningEffort: scope.reasoningEffort ?? null,
    };
    const onActivity = activityOf(context);
    const build = onActivity
      ? await generation.start(generationInput, scope.account, undefined, onActivity)
      : await generation.start(generationInput, scope.account);
    startedRunId = build.runId;
    const stop = () => generation.cancel(build.runId);
    context.signal.addEventListener('abort', stop, { once: true });
    detachAbort = () => context.signal.removeEventListener('abort', stop);
    if (context.signal.aborted) stop();
    context.signal.throwIfAborted();
    set({
      status: 'running',
      runId: build.runId,
      variantRunIds: build.variants.map((variant) => variant.runId),
      startedAt: Date.now(),
    });
    await persist();
    // With telemetry, wait for every variant. Grace would end the tool while two are still
    // running, and their later events would be closed as cancelled.
    const settled = onActivity ? await build.settled : await settleWithGrace(build);
    context.signal.throwIfAborted();
    const done = settled.filter((variant) => variant.state === 'done');
    if (done.length === 0) {
      const reasons = await failureReasons(
        generation,
        settled.map((variant) => variant.runId),
      );
      const error = reasons[0] ?? null;
      set({ status: 'failed', finishedAt: Date.now(), error: buildFailureMessage(error) });
      context.show({ type: 'error', message: buildFailureMessage(error) });
      return {
        output: {
          status: 'failed',
          active: false,
          runId: build.runId,
          error: 'No variant was built.',
          reasons,
          canRetry: true,
        },
        failed: true,
        stop: true,
      };
    }
    const outcomes: VariantOutcome[] = [];
    let audited = true;
    for (const variant of done) {
      const audit = await readAuditCounts(generation, variant.runId);
      if (!audit) audited = false;
      outcomes.push({
        variant: variant.variant,
        deckId: variant.runId,
        errors: audit?.errors ?? null,
        warnings: audit?.warnings ?? null,
        ...(audit ? { review: audit } : {}),
      });
    }
    const recommended = recommend(outcomes);
    const finishedAt = Date.now();
    set({ status: 'done', finishedAt });
    // A variant that failed stays in the result, so the person sees it and can build it again.
    const failed = await Promise.all(
      settled
        .filter((variant) => variant.state === 'failed')
        .map(async ({ variant, runId }) => ({
          variant,
          runId,
          status: 'failed' as const,
          reason: await failureReason(generation, runId),
        })),
    );
    context.show({
      type: 'result',
      buildId: part.buildId,
      ...(failed.length ? { failed } : {}),
      variants: outcomes.map(({ variant, deckId }) => ({ variant, deckId })),
      reviews: audited
        ? Object.fromEntries(
            outcomes.map(({ deckId, errors, warnings, review }) => [
              deckId,
              {
                errors: errors ?? 0,
                warnings: warnings ?? 0,
                status: review?.status,
                contentHash: review?.contentHash,
                contentRevision: review?.contentRevision,
              },
            ]),
          )
        : null,
      recommended,
      elapsedMs: finishedAt - part.startedAt,
    });
    scope.addDecks(
      outcomes.map((outcome) => outcome.deckId),
      outcomes.find((outcome) => outcome.variant === recommended)?.deckId ?? null,
    );
    return {
      output: {
        status: 'done',
        variants: outcomes,
        recommended,
        auditAvailable: audited,
        failedVariants: settled.filter((v) => v.state === 'failed').map((v) => v.variant),
        unfinishedVariants: settled.filter((v) => v.state === 'running').map((v) => v.variant),
      },
    };
  } catch (error) {
    if (startedRunId !== null) generation.cancel(startedRunId);
    if (context.signal.aborted) {
      set({ status: 'cancelled', finishedAt: Date.now() });
      throw error;
    }
    const message = error instanceof Error ? error.message : 'The build failed.';
    set({ status: 'failed', finishedAt: Date.now(), error: buildFailureMessage(message) });
    if (persistenceFailed) throw error;
    context.show({ type: 'error', message: buildFailureMessage(message) });
    return {
      output: {
        status: 'failed',
        active: false,
        runId: startedRunId,
        error: message,
        canRetry: true,
      },
      failed: true,
      stop: true,
    };
  } finally {
    detachAbort();
  }
}

function buildFailureMessage(reason: string | null): string {
  if (/HTTP 429\b/.test(reason ?? ''))
    return (
      'Провайдер модели отклонил запросы из-за лимита (HTTP 429). Сборка остановлена. ' +
      'Повторите запуск позже или выберите другую модель в настройках. План сохранён.'
    );
  return 'Сборка остановлена, готовых вариантов нет. Можно попросить повторить запуск по сохранённому плану.';
}

/** How long the other variants may keep the person waiting once the balanced one is ready. */
export const VARIANT_GRACE_MS = 60000;

/**
 * Wait for the variants of a build, but not for a straggler: once the balanced variant is done,
 * the others get a minute more. One still running then is reported as running and left to finish
 * in the library.
 */
export async function settleWithGrace(
  build: Pick<StartedBuild, 'runId' | 'variants' | 'each'>,
  graceMs = VARIANT_GRACE_MS,
): Promise<{ variant: LayoutVariant; runId: string; state: 'done' | 'failed' | 'running' }[]> {
  const ended = new Map<string, VariantEnd>();
  for (const pending of build.each) void pending.then((end) => ended.set(end.runId, end));
  const primary = build.each[build.variants.findIndex((item) => item.runId === build.runId)];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const grace = primary
    ? primary.then((end) =>
        end.state === 'done'
          ? new Promise<void>((resolve) => (timer = setTimeout(resolve, graceMs)))
          : new Promise<void>(() => undefined),
      )
    : new Promise<void>(() => undefined);
  await Promise.race([Promise.all(build.each), grace]);
  clearTimeout(timer);
  return build.variants.map(
    (item) =>
      ended.get(item.runId) ?? { variant: item.variant, runId: item.runId, state: 'running' },
  );
}

/** Why the runs of a build failed, as each wrote it down, without repeats. */
async function failureReasons(
  generation: GenerationService,
  runIds: readonly string[],
): Promise<string[]> {
  const reasons = new Set<string>();
  for (const runId of runIds) {
    const reason = await failureReason(generation, runId);
    if (reason) reasons.add(reason);
  }
  return [...reasons];
}

/** Why one run failed, as it wrote it down; null — it wrote no reason. */
export async function failureReason(
  generation: GenerationService,
  runId: string,
): Promise<string | null> {
  try {
    const failure = z
      .object({ message: z.string() })
      .parse(JSON.parse(await readFile(join(generation.directory(runId), 'failure.json'), 'utf8')));
    return failure.message.slice(0, 500);
  } catch {
    return null;
  }
}

/** The final review of a finished variant, when it still matches the deck that was built. */
export async function readAuditCounts(generation: GenerationService, deckId: string) {
  return readFinalReview(generation.directory(deckId));
}
