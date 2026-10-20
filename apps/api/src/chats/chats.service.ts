import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Optional,
  Logger,
  NotFoundException,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Pool } from 'pg';
import {
  chatMessageSchema,
  chatModeSchema,
  chatPartSchema,
  layoutVariantSchema,
  modelRefSchema,
  type ModelRef,
  type AssistantChatMessage,
  type ChatAttachment,
  type ChatDocument,
  type ChatEvent,
  type ChatMessage,
  type ChatMode,
  type ChatPart,
  type ChatSummary,
  type ChatTurnRequest,
  type ChatToolActivity,
  type DeckOutline,
} from '@lct/contracts';
import { loadAgent } from '@lct/registry';
import { PostgresProviderLedger } from '@lct/run-store';
import {
  AnswerWriter,
  ModelRequestError,
  modelFailureOf,
  chatInstructions,
  loadChatAgent,
  modelHistory,
  OpenAICompatibleChatModel,
  runChatTurn,
  toolSpecs,
  loadMaterialResearchAgent,
  researchMaterials,
  closeToolPart,
  mergeToolActivity,
  type ChatAgent,
  type ChatEventBody,
  type ChatModel,
  ledgerFetch,
  type ChatUsage,
} from '@lct/pipeline';
import type { Account } from '../accounts/account-rules.js';
import { visibleFile } from '../files/template-visibility.js';
import { actorOf, GenerationService } from '../generation/generation.service.js';
import {
  ModelSettingsService,
  ModelNotConfiguredError,
  type ResolvedModel,
} from '../models/model-settings.service.js';
import { ModelCapabilityService } from '../models/model-capabilities.js';
import {
  resultOf,
  withFailed,
  withVariant,
  type FailedVariant,
  type ResultPart,
} from './chat-results.js';
import {
  chatTools,
  failureReason,
  readAuditCounts,
  runBuild,
  type ChatToolScope,
  type ChatWebDependency,
} from './chat-tools.js';
import { acquireChatLease, type ChatLease } from './chat-lease.js';
import { join } from 'node:path';
import { createAssetSearch, type AssetSearch } from './asset-search.js';
import { createWebSearch, webSearchBaseUrl, type WebSearch } from './web-search.js';
import { fetchWebSource } from './web-source.js';
import { AccountUsageService } from '../accounts/account-usage.service.js';
import { EditorService } from '../editor/editor.service.js';
import { readPreparation } from './preparation.js';
import { questionsAllowed } from './discovery-policy.js';

export const CHAT_ID = /^[0-9a-f-]{36}$/i;
const TITLE_MAX_LENGTH = 200;
/** A chat is text and small cards; a document this large is a runaway turn. */
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
/** How often a turn in progress is written down, so a reload finds most of it. */
const SAVE_EVERY_MS = 500;

interface ChatRow {
  readonly id: string;
  readonly title: string;
  readonly project_id: string | null;
  readonly deck_ids: string[];
  readonly primary_deck_id: string | null;
  readonly mode: string;
  readonly model?: unknown;
  readonly messages?: unknown;
  readonly created_at: Date;
  readonly updated_at: Date;
}

const SUMMARY_COLUMNS =
  'id, title, project_id, deck_ids, primary_deck_id, mode, model, created_at, updated_at';

function summaryOf(row: ChatRow): ChatSummary {
  return {
    chatId: row.id,
    title: row.title,
    projectId: row.project_id,
    deckIds: row.deck_ids,
    deckId:
      row.primary_deck_id !== null && row.deck_ids.includes(row.primary_deck_id)
        ? row.primary_deck_id
        : null,
    mode: chatModeSchema.catch('plan').parse(row.mode),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Stored messages, the ones that no longer read as messages left out. */
function messagesOf(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = chatMessageSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export function checkedTitle(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException('Chat title is required.');
  }
  return value.trim().slice(0, TITLE_MAX_LENGTH);
}

/** The title of a new chat: its first words, cut at a word. */
export function titleOf(text: string, attachments: readonly ChatAttachment[]): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (!line) return attachments[0]?.name ?? 'Новый чат';
  if (line.length <= 60) return line;
  const cut = line.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 60)}…`;
}

/** Usage grows with every streamed chunk; the person needs only a few updates a second. */
const USAGE_INTERVAL_MS = 250;

function usageEvents(messageId: string, emit: (event: ChatEventBody) => void) {
  let latest: ChatUsage | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (latest) emit({ type: 'usage', messageId, ...latest });
    latest = null;
  };
  return {
    report: (usage: ChatUsage) => {
      latest = usage;
      timer ??= setTimeout(flush, USAGE_INTERVAL_MS);
    },
    flush,
  };
}

/**
 * A turn being answered. Everything it does is an event. The one who sent the turn gets every
 * event from its start, even those before the stream opened; one who comes later reads the chat
 * as it is and then gets only what follows.
 */
class Turn {
  private seq = 0;
  private readonly events: ChatEvent[] = [];
  private readonly listeners = new Set<(event: ChatEvent) => void>();
  readonly controller = new AbortController();
  finished = false;
  lease: ChatLease | null = null;
  stopWhenUnwatched = false;
  operation: { id: string; worker: string } | null = null;

  constructor(readonly chatId: string) {}

  emit(event: ChatEventBody | { type: 'turn-end' } | { type: 'ping' }): void {
    const numbered = { ...event, seq: this.seq++ } as ChatEvent;
    if (numbered.type !== 'ping') this.events.push(numbered);
    for (const listener of this.listeners) listener(numbered);
  }

  watch(listener: (event: ChatEvent) => void, fromStart: boolean): () => void {
    if (fromStart) for (const event of this.events) listener(event);
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (this.stopWhenUnwatched && this.listeners.size === 0) this.controller.abort();
    };
  }
}

/** The state of a chat a turn works on: read once, written as it changes. */
interface ChatState {
  readonly id: string;
  readonly ownerId: string;
  title: string;
  projectId: string | null;
  mode: ChatMode;
  messages: ChatMessage[];
  deckIds: string[];
  primaryDeckId: string | null;
  persisted: boolean;
  initialModel?: ModelRef | null;
}

interface ApprovedPlan {
  readonly planId: string;
  readonly revision: number;
  readonly outline: DeckOutline;
  readonly templateId: string;
}

interface AcceptedInput {
  readonly approved: ApprovedPlan | null;
  readonly replay?: boolean;
}

/**
 * Chats of the signed-in account, answered by the chat agent. A turn runs in this process and
 * goes on when the person closes the page; they come back to the chat as it was written down, and
 * a turn still running streams on from there. Another account's chat is answered as missing.
 */
@Injectable()
export class ChatsService implements OnApplicationShutdown {
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });
  /** Held leases cannot consume the query pool: saves still need a connection at capacity. */
  private readonly lockPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 16,
    connectionTimeoutMillis: 10000,
  });
  private readonly logger = new Logger(ChatsService.name);
  private readonly turns = new Map<string, Turn>();
  private readonly remoteStreams = new Set<Turn>();
  private agent: Promise<ChatAgent> | null = null;

  constructor(
    @Inject(GenerationService) private readonly generation: GenerationService,
    @Inject(ModelSettingsService) private readonly models: ModelSettingsService,
    @Inject(ModelCapabilityService) private readonly capabilities: ModelCapabilityService,
    @Optional() @Inject(AccountUsageService) private readonly usage?: AccountUsageService,
    @Optional() @Inject(EditorService) private readonly editor?: EditorService,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    for (const turn of this.turns.values()) turn.controller.abort();
    for (const turn of this.remoteStreams) turn.controller.abort();
    await Promise.all([this.pool.end(), this.lockPool.end()]);
  }

  private loadAgent(): Promise<ChatAgent> {
    this.agent ??= loadChatAgent(this.generation.registryDir()).catch((error: unknown) => {
      this.agent = null;
      throw error;
    });
    return this.agent;
  }

  private webDependency(
    request: ChatTurnRequest,
    account: Account,
    agent: ChatAgent,
  ): ChatWebDependency {
    const baseUrl = webSearchBaseUrl(process.env);
    let search: WebSearch | null = null;
    let assets: AssetSearch | null = null;
    if (baseUrl !== null) {
      try {
        search = createWebSearch({ baseUrl });
      } catch {
        search = null;
      }
      try {
        assets = createAssetSearch({ baseUrl });
      } catch {
        assets = null;
      }
    }
    return {
      search,
      fetchSource: fetchWebSource,
      ...(assets ? { assets } : {}),
      research: {
        run: async (question, sources, researchSignal) => {
          const researcher = await loadAgent(join(this.generation.registryDir(), 'web-researcher'));
          const researchModel = await this.chatModel(request, account, {
            ...agent,
            agent: researcher,
          });
          researchSignal.throwIfAborted();
          return researchMaterials({
            question,
            sources,
            model: researchModel,
            agent: researcher,
            signal: researchSignal,
            seed: 42,
          });
        },
      },
    };
  }

  async list(
    account: Account,
    filter: { projectId?: string; deckId?: string },
  ): Promise<ChatSummary[]> {
    const result = await this.pool.query<ChatRow>(
      `SELECT ${SUMMARY_COLUMNS} FROM chats
       WHERE owner_id = $1
         AND ($2::text IS NULL OR project_id = $2)
         AND ($3::text IS NULL OR $3 = ANY(deck_ids))
       ORDER BY updated_at DESC`,
      [account.id, filter.projectId ?? null, filter.deckId ?? null],
    );
    return result.rows.map(summaryOf);
  }

  async get(id: string, account: Account): Promise<ChatDocument> {
    const result = await this.pool.query<ChatRow>(
      `SELECT ${SUMMARY_COLUMNS}, messages FROM chats WHERE id = $1 AND owner_id = $2`,
      [id, account.id],
    );
    let row = result.rows[0];
    if (!row) throw new NotFoundException('Chat not found.');
    let running = this.turns.has(id);
    if (!running) {
      const lease = await acquireChatLease(this.lockPool, id);
      running = lease === null;
      if (lease) {
        try {
          // Read again under the lease: the preceding owner may have just finished.
          const fresh = await this.pool.query<ChatRow>(
            `SELECT ${SUMMARY_COLUMNS}, messages FROM chats WHERE id = $1 AND owner_id = $2`,
            [id, account.id],
          );
          row = fresh.rows[0];
          if (!row) throw new NotFoundException('Chat not found.');
          const state = this.stateOf(row, account.id);
          if (this.recoverInterrupted(state)) {
            await this.save(state);
            row = { ...row, messages: state.messages };
          }
        } finally {
          await lease.release();
        }
      }
    }
    return {
      ...summaryOf(row),
      model: modelRefSchema.nullable().catch(null).parse(row.model),
      messages: messagesOf(row.messages).map((message) => this.withoutStaleRetries(message)),
      running,
    };
  }

  /** Runs of variants being built again whose result is not written into the chat yet. */
  private readonly rebuilding = new Set<string>();

  /**
   * A variant shown as being built again whose run this process no longer builds was cut short by
   * a restart: it reads as failed, and the person can start it again.
   */
  private withoutStaleRetries(message: ChatMessage): ChatMessage {
    if (message.role !== 'assistant') return message;
    return {
      ...message,
      parts: message.parts.map((part) =>
        part.type === 'result' && part.failed?.some((item) => this.stale(item))
          ? {
              ...part,
              failed: part.failed.map((item) =>
                this.stale(item)
                  ? {
                      ...item,
                      status: 'failed' as const,
                      reason: 'Сервер перезапустился во время сборки. Запустите её ещё раз.',
                    }
                  : item,
              ),
            }
          : part,
      ),
    };
  }

  private stale(item: FailedVariant): boolean {
    return (
      item.status === 'retrying' &&
      !this.generation.isRunning(item.runId) &&
      !this.rebuilding.has(item.runId)
    );
  }

  /**
   * Build again a variant of a build in the chat that failed, from the plan its build kept. The
   * result shows it as being rebuilt at once; once its run ends, the variant takes its place in
   * the result, or the result says again why it failed. Answers the result as it is now.
   */
  async retryVariant(
    id: string,
    body: { buildId?: unknown; variant?: unknown },
    account: Account,
  ): Promise<ResultPart> {
    const variant = layoutVariantSchema.safeParse(body.variant);
    if (typeof body.buildId !== 'string' || !variant.success)
      throw new BadRequestException('buildId and variant are required.');
    const buildId = body.buildId;
    if (this.turns.has(id))
      throw new ConflictException('The chat is answering; build the variant once it is done.');
    const found = resultOf((await this.get(id, account)).messages, buildId);
    const entry = found?.failed?.find((item) => item.variant === variant.data);
    if (!found || !entry) throw new NotFoundException('No failed variant to build again.');
    // A second press while it builds answers the same result instead of a second run.
    if (entry.status === 'retrying') return found;
    const build = await this.generation.retryVariant(entry.runId, account);
    const started = build.variants[0];
    const ended = build.each[0];
    if (!started || !ended) throw new ConflictException('The variant could not be started.');
    this.rebuilding.add(started.runId);
    const retrying = await this.patchResult(id, account.id, buildId, (part) =>
      withFailed(part, {
        variant: variant.data,
        runId: started.runId,
        status: 'retrying',
        reason: null,
      }),
    );
    void ended
      .then(async (end) => {
        if (end.state === 'done') {
          const review = await readAuditCounts(this.generation, end.runId);
          await this.patchResult(
            id,
            account.id,
            buildId,
            (part) => withVariant(part, variant.data, end.runId, review),
            end.runId,
          );
        } else {
          const reason = await failureReason(this.generation, end.runId);
          await this.patchResult(id, account.id, buildId, (part) =>
            withFailed(part, { variant: variant.data, runId: end.runId, status: 'failed', reason }),
          );
        }
      })
      .catch((error: unknown) =>
        this.logger.warn(`Could not write the rebuilt variant into chat ${id}: ${String(error)}`),
      )
      .finally(() => this.rebuilding.delete(started.runId));
    return retrying ?? found;
  }

  /** Wait until no turn answers in the chat and its last write is done. */
  private async whenIdle(id: string): Promise<void> {
    for (let turn = this.turns.get(id); turn; turn = this.turns.get(id)) {
      const current = turn;
      await new Promise<void>((resolve) => {
        const stop = current.watch((event) => {
          if (event.type !== 'turn-end') return;
          queueMicrotask(() => stop());
          resolve();
        }, true);
      });
    }
    await this.saving.get(id)?.catch(() => undefined);
  }

  /**
   * Change the result of a build where the chat keeps it, outside a turn: after the turn running
   * now, in line with the chat's other writes. Messages are changed in place as stored, so one
   * this version cannot read is kept, not dropped. `deckId` joins the decks of the chat.
   */
  private async patchResult(
    id: string,
    ownerId: string,
    buildId: string,
    change: (part: ResultPart) => ResultPart,
    deckId?: string,
  ): Promise<ResultPart | null> {
    await this.whenIdle(id);
    let changed: ResultPart | null = null;
    const write = async () => {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const found = await client.query<{ messages: unknown }>(
          'SELECT messages FROM chats WHERE id = $1 AND owner_id = $2 FOR UPDATE',
          [id, ownerId],
        );
        const stored = found.rows[0]?.messages;
        if (!Array.isArray(stored)) {
          await client.query('ROLLBACK');
          return;
        }
        const messages = stored.map((message: unknown) => {
          if (typeof message !== 'object' || message === null) return message;
          const parts = (message as { parts?: unknown }).parts;
          if (!Array.isArray(parts)) return message;
          return {
            ...message,
            parts: parts.map((raw: unknown) => {
              const part = chatPartSchema.safeParse(raw);
              if (!part.success || part.data.type !== 'result' || part.data.buildId !== buildId)
                return raw;
              changed = change(part.data);
              return changed;
            }),
          };
        });
        if (!changed) {
          await client.query('ROLLBACK');
          return;
        }
        await client.query(
          `UPDATE chats SET messages = $2::jsonb,
                  deck_ids = CASE WHEN $3::text IS NULL OR $3 = ANY(deck_ids) THEN deck_ids
                                  ELSE array_append(deck_ids, $3) END
           WHERE id = $1`,
          [id, JSON.stringify(messages), deckId ?? null],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    };
    const next = (this.saving.get(id) ?? Promise.resolve()).catch(() => undefined).then(write);
    this.saving.set(id, next);
    await next;
    return changed;
  }

  /**
   * Rename a chat, move it to another project (null: out of projects) or pick the deck it leads
   * to. Its decks move with it. None of it counts as an edit: the chat keeps its place.
   */
  async update(
    id: string,
    body: { title?: unknown; projectId?: unknown; deckId?: unknown; model?: unknown },
    account: Account,
  ): Promise<ChatSummary> {
    const selection =
      body.model === undefined ? undefined : modelRefSchema.nullable().safeParse(body.model);
    if (selection && !selection.success) throw new BadRequestException('Invalid model selection.');
    const title = body.title === undefined ? null : checkedTitle(body.title);
    const moves = body.projectId !== undefined;
    if (moves && body.projectId !== null && typeof body.projectId !== 'string') {
      throw new BadRequestException('projectId must be a string or null.');
    }
    if (typeof body.projectId === 'string') await this.requireProject(body.projectId, account);
    if (body.deckId !== undefined && typeof body.deckId !== 'string') {
      throw new BadRequestException('deckId must be a deck of the chat.');
    }
    const result = await this.pool.query<ChatRow>(
      `UPDATE chats SET title = COALESCE($3, title),
              project_id = CASE WHEN $4::boolean THEN $5 ELSE project_id END,
              primary_deck_id = CASE WHEN $6::text IS NOT NULL AND $6 = ANY(deck_ids)
                                     THEN $6 ELSE primary_deck_id END,
              model = CASE WHEN $7::boolean THEN $8::jsonb ELSE model END
       WHERE id = $1 AND owner_id = $2 RETURNING ${SUMMARY_COLUMNS}`,
      [
        id,
        account.id,
        title,
        moves,
        moves ? body.projectId : null,
        body.deckId ?? null,
        selection !== undefined,
        selection?.success ? JSON.stringify(selection.data) : null,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Chat not found.');
    if (moves) {
      for (const deckId of row.deck_ids) {
        if (await this.generation.library.visible(deckId, account.id)) {
          await this.generation.library.patch(deckId, { projectId: row.project_id });
        }
      }
    }
    return summaryOf(row);
  }

  /** Deleting a chat deletes the decks it produced: the chat is how a person finds them. */
  async remove(id: string, account: Account): Promise<void> {
    await this.get(id, account);
    this.turns.get(id)?.controller.abort();
    await this.pool.query("SELECT pg_notify('chat_turn_cancel', $1)", [id]);
    const result = await this.pool.query<{ deck_ids: string[] }>(
      'DELETE FROM chats WHERE id = $1 AND owner_id = $2 RETURNING deck_ids',
      [id, account.id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Chat not found.');
    for (const deckId of row.deck_ids) {
      if (await this.generation.library.visible(deckId, account.id)) {
        await this.generation.library.remove(deckId);
      }
    }
  }

  /** Stop the turn being answered; what it said so far stays. */
  async cancel(id: string, account: Account): Promise<void> {
    await this.get(id, account);
    this.turns.get(id)?.controller.abort();
    await this.pool.query("SELECT pg_notify('chat_turn_cancel', $1)", [id]);
  }

  /**
   * Watch the turn of a chat: the answer as it stands, then its events until it ends. Null — no
   * turn is running.
   */
  async attach(id: string, account: Account): Promise<Turn | null> {
    const document = await this.get(id, account);
    const local = this.turns.get(id);
    if (local) return local;
    if (!document.running) return null;
    const turn = new Turn(id);
    turn.stopWhenUnwatched = true;
    this.remoteStreams.add(turn);
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      clearTimeout(timer);
      if (turn.finished) return;
      turn.finished = true;
      turn.emit({ type: 'turn-end' });
      this.remoteStreams.delete(turn);
    };
    turn.controller.signal.addEventListener('abort', finish, { once: true });
    const poll = async () => {
      try {
        const snapshot = await this.get(id, account);
        if (turn.finished) return;
        for (const message of snapshot.messages) turn.emit({ type: 'message', message });
        if (!snapshot.running) finish();
        else timer = setTimeout(() => void poll(), 500);
      } catch (error) {
        this.logger.warn(
          `Chat ${id} remote stream failed: ${error instanceof Error ? error.message : error}`,
        );
        turn.emit({
          type: 'message',
          message: {
            role: 'assistant',
            id: crypto.randomUUID(),
            status: 'failed',
            createdAt: Date.now(),
            parts: [
              {
                type: 'error',
                message: 'Не удалось восстановить соединение с чатом. Обновите страницу.',
              },
            ],
          },
        });
        finish();
      }
    };
    timer = setTimeout(() => void poll(), 0);
    return turn;
  }

  /** The answer being written in a turn, for one who starts watching it midway. */
  currentAnswer = new Map<string, () => AssistantChatMessage | null>();

  /**
   * Start a turn: put the person's message (or answer, or approval) into the chat, then have the
   * agent answer. The chat is created by its first turn, with the id the web chose.
   */
  async startTurn(id: string, request: ChatTurnRequest, account: Account): Promise<Turn> {
    if (!CHAT_ID.test(id)) throw new BadRequestException('Invalid chat id.');
    if (this.turns.has(id)) throw new ConflictException('The chat is answering already.');
    const turn = new Turn(id);
    this.turns.set(id, turn);
    try {
      await this.openChat(id, request, account);
      turn.lease = await acquireChatLease(this.lockPool, id, turn.controller);
      if (!turn.lease) throw new ConflictException('The chat is answering already.');
      const state = await this.openChat(id, request, account);
      if (this.recoverInterrupted(state)) await this.save(state);
      const operationId = `chat:${id}:${request.requestId ?? (request.input.type === 'message' ? crypto.randomUUID() : request.input.type === 'answer' ? request.input.questionId : request.input.planId)}`;
      const usage = this.usage;
      const worker =
        usage && request.input.type !== 'approve-plan'
          ? await usage.translate(() =>
              usage.store.admit(account.id, operationId, 'assistant-response'),
            )
          : null;
      const operationHeartbeat = worker
        ? setInterval(() => {
            void this.usage?.store
              .renew(account.id, operationId, worker)
              .catch((error) => turn.controller.abort(error));
          }, 15000)
        : null;
      turn.operation = worker ? { id: operationId, worker } : null;
      let prepared: AcceptedInput;
      try {
        prepared = await this.acceptInput(state, request, account, turn);
      } catch (error) {
        if (operationHeartbeat) clearInterval(operationHeartbeat);
        if (worker) await this.usage?.store.finish(account.id, operationId, false, worker);
        throw error;
      }
      if (prepared.replay) {
        if (operationHeartbeat) clearInterval(operationHeartbeat);
        if (worker) await this.usage?.store.finish(account.id, operationId, false, worker);
        for (const message of state.messages) turn.emit({ type: 'message', message });
        turn.finished = true;
        this.turns.delete(id);
        await turn.lease.release();
        turn.emit({ type: 'turn-end' });
        return turn;
      }
      void this.answer(state, request, account, turn, prepared)
        .catch((error: unknown) => {
          this.logger.error(
            `Chat ${id} could not save its final state: ${error instanceof Error ? error.message : error}`,
          );
        })
        .finally(async () => {
          if (operationHeartbeat) clearInterval(operationHeartbeat);
          // Only the durable message transaction counts success. An in-memory done message
          // whose final save failed must never consume a successful-response allowance.
          if (worker) await this.usage?.store.finish(account.id, operationId, false, worker);
          turn.finished = true;
          this.turns.delete(id);
          this.currentAnswer.delete(id);
          turn.emit({ type: 'turn-end' });
          await turn.lease?.release();
        });
      return turn;
    } catch (error) {
      this.turns.delete(id);
      await turn.lease?.release();
      throw error;
    }
  }

  private async requireProject(projectId: string, account: Account): Promise<void> {
    const project = await this.pool.query(
      'SELECT 1 FROM library_projects WHERE id = $1 AND owner_id = $2',
      [projectId, account.id],
    );
    if (!project.rowCount) throw new NotFoundException('Project not found.');
  }

  private async openChat(
    id: string,
    request: ChatTurnRequest,
    account: Account,
  ): Promise<ChatState> {
    const result = await this.pool.query<ChatRow & { owner_id: string }>(
      `SELECT ${SUMMARY_COLUMNS}, owner_id, messages FROM chats WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (row && row.owner_id !== account.id) throw new NotFoundException('Chat not found.');
    if (row) {
      return this.stateOf(row, account.id);
    }
    if (request.input.type !== 'message') throw new NotFoundException('Chat not found.');
    if (request.projectId !== null) await this.requireProject(request.projectId, account);
    const deck =
      request.deckId !== null && (await this.generation.library.visible(request.deckId, account.id))
        ? request.deckId
        : null;
    // A chat started at a deck lives where the deck does.
    const projectId =
      request.projectId ?? (deck ? (await this.generation.library.read(deck)).projectId : null);
    return {
      id,
      ownerId: account.id,
      title: titleOf(request.input.text, request.input.attachments),
      projectId,
      mode: request.mode,
      messages: [],
      deckIds: deck ? [deck] : [],
      primaryDeckId: deck,
      persisted: false,
      initialModel: request.model,
    };
  }

  private stateOf(row: ChatRow, ownerId: string): ChatState {
    return {
      id: row.id,
      ownerId,
      title: row.title,
      projectId: row.project_id,
      mode: chatModeSchema.catch('plan').parse(row.mode),
      messages: messagesOf(row.messages),
      deckIds: [...row.deck_ids],
      primaryDeckId: row.primary_deck_id,
      persisted: true,
    };
  }

  /** A lost process never makes an in-flight side effect safe to repeat. */
  private recoverInterrupted(state: ChatState): boolean {
    let changed = false;
    state.messages = state.messages.map((message) => {
      if (message.role !== 'assistant') return message;
      const active =
        message.status === 'streaming' ||
        message.parts.some(
          (part) =>
            (part.type === 'build' && (part.status === 'preparing' || part.status === 'running')) ||
            (part.type === 'tool' &&
              (part.status === 'running' ||
                part.activities?.some((item) => item.status === 'running') === true)),
        );
      if (!active) return message;
      changed = true;
      const explanation =
        'Ответ прерван после остановки сервера. Проверьте результаты в библиотеке перед повторной сборкой.';
      const interrupted =
        message.status === 'streaming' ||
        message.parts.some(
          (part) =>
            (part.type === 'build' && (part.status === 'preparing' || part.status === 'running')) ||
            (part.type === 'tool' && part.status === 'running'),
        );
      if (!interrupted) {
        return {
          ...message,
          parts: message.parts.map((part): ChatPart =>
            part.type === 'tool' ? closeToolPart(part, 'failed', part.output, 'cancelled') : part,
          ),
        };
      }
      return {
        ...message,
        status: 'failed' as const,
        parts: [
          ...message.parts.map((part): ChatPart => {
            if (part.type === 'build' && (part.status === 'preparing' || part.status === 'running'))
              return { ...part, status: 'failed', finishedAt: Date.now(), error: explanation };
            if (part.type === 'tool')
              return closeToolPart(
                part,
                'failed',
                part.status === 'running'
                  ? { error: 'interrupted', message: explanation }
                  : part.output,
                'cancelled',
              );
            return part;
          }),
          { type: 'error' as const, message: explanation },
        ],
      };
    });
    return changed;
  }

  /** Files and templates a message attaches, as the account may use them, named from the library. */
  private async checkedAttachments(
    attachments: readonly ChatAttachment[],
    account: Account,
  ): Promise<ChatAttachment[]> {
    const checked: ChatAttachment[] = [];
    for (const attachment of attachments) {
      if (attachment.kind === 'slides') {
        // What the editor showed is the person's own words about their deck, if it is theirs.
        if (!(await this.generation.library.visible(attachment.deckId, account.id)))
          throw new NotFoundException('The deck is not in the library.');
        checked.push(attachment);
        continue;
      }
      if (attachment.kind === 'brandbook') {
        const result = await this.pool.query<{ name: string }>(
          `SELECT COALESCE(display_name, file_name) AS name FROM stored_files
           WHERE id = $1 AND kind = 'brandbook' AND ${visibleFile(2)}`,
          [attachment.brandbookId, account.id],
        );
        if (!result.rows[0])
          throw new NotFoundException('An attached brandbook is not in the library.');
        checked.push({ ...attachment, name: result.rows[0].name });
        continue;
      }
      const id = attachment.kind === 'file' ? attachment.fileId : attachment.templateId;
      const kind = attachment.kind === 'file' ? 'content' : 'template';
      const result = await this.pool.query<{ name: string; size_bytes: string }>(
        `SELECT COALESCE(display_name, file_name) AS name, size_bytes FROM stored_files
         WHERE id = $1 AND kind = $3 AND ${visibleFile(2)}`,
        [id, account.id, kind],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundException('An attached file is not in the library.');
      checked.push(
        attachment.kind === 'file'
          ? { ...attachment, name: row.name, size: Number(row.size_bytes) }
          : { ...attachment, name: row.name },
      );
    }
    return checked;
  }

  /**
   * Put what the turn brings into the chat. A message is a message; an answer fills the question
   * it answers and reads as the person's message; an approval marks the plan approved, with the
   * person's edits, and is built without asking the model.
   */
  private async acceptInput(
    state: ChatState,
    request: ChatTurnRequest,
    account: Account,
    turn: Turn,
  ): Promise<AcceptedInput> {
    const input = request.input;
    if (input.type === 'approve-plan' && request.mode === 'chat')
      throw new BadRequestException('A plan cannot be built in chat mode.');
    const now = Date.now();
    if (input.type === 'message') {
      const existing = request.requestId
        ? state.messages.find((message) => message.id === request.requestId)
        : null;
      if (existing) {
        if (
          existing.role !== 'user' ||
          existing.mode !== request.mode ||
          existing.text !== input.text ||
          JSON.stringify(existing.attachments) !==
            JSON.stringify(await this.checkedAttachments(input.attachments, account))
        )
          throw new ConflictException('This request id was used with different content.');
        return { approved: null, replay: true };
      }
      if (!input.text && input.attachments.length === 0)
        throw new BadRequestException('The message is empty.');
      const message: ChatMessage = {
        role: 'user',
        id: request.requestId ?? crypto.randomUUID(),
        text: input.text,
        attachments: await this.checkedAttachments(input.attachments, account),
        mode: request.mode,
        createdAt: now,
      };
      state.messages.push(message);
      state.mode = request.mode;
      turn.emit({ type: 'message', message });
      await this.save(state);
      return { approved: null };
    }
    const found = this.findPart(state, (part) =>
      input.type === 'answer'
        ? part.type === 'question' && part.questionId === input.questionId
        : part.type === 'plan' && part.planId === input.planId,
    );
    if (!found) throw new NotFoundException('There is nothing to answer here.');
    if (input.type === 'answer') {
      if (
        found.part.type === 'question' &&
        found.part.answer !== null &&
        state.mode === request.mode &&
        JSON.stringify(found.part.answer) === JSON.stringify(input.answer)
      )
        return { approved: null, replay: true };
      if (found.part.type !== 'question' || found.part.answer !== null)
        throw new ConflictException('The question is answered already.');
      const question = found.part;
      const latestQuestion = state.messages
        .flatMap((message) =>
          message.role === 'assistant'
            ? message.parts.filter((part) => part.type === 'question')
            : [],
        )
        .at(-1);
      if (latestQuestion?.type !== 'question' || latestQuestion.questionId !== input.questionId)
        throw new ConflictException('This question was replaced by a newer question.');
      if (
        (!input.answer.text && input.answer.optionLabels.length === 0) ||
        (!question.multiSelect && input.answer.optionLabels.length > 1) ||
        input.answer.optionLabels.some(
          (label) => !question.options.some((option) => option.label === label),
        )
      )
        throw new BadRequestException('Choose an offered option or enter an answer.');
      this.putPart(state, turn, found.messageId, found.index, {
        ...found.part,
        answer: input.answer,
      });
      const message: ChatMessage = {
        role: 'user',
        id: crypto.randomUUID(),
        text: [...input.answer.optionLabels, input.answer.text].filter(Boolean).join('\n'),
        attachments: [],
        mode: request.mode,
        createdAt: now,
      };
      state.messages.push(message);
      state.mode = request.mode;
      turn.emit({ type: 'message', message });
      await this.save(state);
      return { approved: null };
    }
    if (found.part.type !== 'plan' || found.part.status === 'superseded')
      throw new ConflictException('This plan was replaced by a newer one.');
    const latest = state.messages
      .flatMap((message) =>
        message.role === 'assistant'
          ? message.parts.filter((part) => part.type === 'plan' && part.status !== 'superseded')
          : [],
      )
      .at(-1);
    if (latest?.type === 'plan' && latest.planId !== found.part.planId)
      throw new ConflictException('This plan was replaced by a newer plan.');
    const revision = found.part.revision ?? 1;
    const requestedRevision = input.revision ?? 1;
    if (found.part.status === 'approved' && requestedRevision === revision) {
      if (
        state.mode !== request.mode ||
        found.part.templateId !== input.templateId ||
        JSON.stringify(found.part.outline) !== JSON.stringify(input.outline)
      )
        throw new ConflictException('This revision is approved already. Submit a new revision.');
      return { approved: null, replay: true };
    }
    const expectedRevision = found.part.status === 'approved' ? revision + 1 : revision;
    if (requestedRevision !== expectedRevision)
      throw new ConflictException('The plan revision changed. Reload the latest plan.');
    await this.generation.template(input.templateId, account);
    const approved: ApprovedPlan = {
      planId: input.planId,
      revision: requestedRevision,
      outline: structuredClone(input.outline),
      templateId: input.templateId,
    };
    this.putPart(state, turn, found.messageId, found.index, {
      ...found.part,
      ...approved,
      status: 'approved',
      approvalSource: 'user',
    });
    state.mode = request.mode;
    await this.save(state);
    return { approved };
  }

  private findPart(state: ChatState, match: (part: ChatPart) => boolean) {
    for (const message of state.messages) {
      if (message.role !== 'assistant') continue;
      const index = message.parts.findIndex(match);
      const part = message.parts[index];
      if (part) return { messageId: message.id, index, part };
    }
    return null;
  }

  private putPart(
    state: ChatState,
    turn: Turn,
    messageId: string,
    index: number,
    part: ChatPart,
  ): void {
    state.messages = state.messages.map((message) =>
      message.id === messageId && message.role === 'assistant'
        ? { ...message, parts: message.parts.map((item, at) => (at === index ? part : item)) }
        : message,
    );
    turn.emit({ type: 'part', messageId, index, part });
  }

  /** The model of the chat: the one picked in the chat, the assistant's, or the writer's. */
  private async resolvedChatModel(
    request: ChatTurnRequest,
    account: Account,
  ): Promise<ResolvedModel> {
    const actor = actorOf(account);
    return request.model !== null
      ? await this.models.resolve(request.model, actor)
      : ((await this.models.resolveRole('assistant', actor)) ??
          (await this.models.resolve(null, actor)));
  }

  private async chatModel(
    request: ChatTurnRequest,
    account: Account,
    agent: ChatAgent,
    preResolved?: ResolvedModel,
  ) {
    const resolved = preResolved ?? (await this.resolvedChatModel(request, account));
    const model = new OpenAICompatibleChatModel({
      apiKey: resolved.apiKey,
      baseUrl: resolved.baseUrl,
      model: resolved.model,
      headers: resolved.headers,
      generation: agent.agent.config.generation,
      jsonModeInstructions: agent.jsonMode,
      reasoningEffort: request.reasoningEffort,
      // The chat thinks as its config says; the person's switch is for the decks it builds.
      thinking: agent.agent.config.generation.thinking ?? null,
      reasoning: await this.capabilities.reasoningOf(resolved),
      fetchImpl: ledgerFetch(
        new PostgresProviderLedger(this.pool, account.id, null, {
          requests: 10000,
          tokens: 100_000_000,
          cost: null,
        }),
        'chat',
        fetch,
        undefined,
        resolved,
      ),
    });
    return withConnection(model, resolved.connectionId);
  }

  private async answer(
    state: ChatState,
    request: ChatTurnRequest,
    account: Account,
    turn: Turn,
    prepared: AcceptedInput,
  ): Promise<void> {
    const signal = turn.controller.signal;
    const message: AssistantChatMessage = {
      role: 'assistant',
      id: crypto.randomUUID(),
      parts: [],
      status: 'streaming',
      createdAt: Date.now(),
    };
    if (turn.operation)
      await this.usage?.store.bindResult(
        account.id,
        turn.operation.id,
        turn.operation.worker,
        message.id,
      );
    state.messages.push(message);
    turn.emit({ type: 'message', message });
    const writer = new AnswerWriter(message.id, (event) => {
      turn.emit(event);
      this.saveSoon(state);
    });
    const usage = usageEvents(message.id, (event) => turn.emit(event));
    let status: AssistantChatMessage['status'] = 'streaming';
    const current = (): AssistantChatMessage => ({ ...message, status, parts: [...writer.parts] });
    const sync = () => {
      state.messages = state.messages.map((item) => (item.id === message.id ? current() : item));
    };
    this.currentAnswer.set(state.id, () => {
      sync();
      return current();
    });
    let scope: ChatToolScope = {
      account,
      chatId: state.id,
      projectId: state.projectId,
      mode: request.mode,
      model: request.model,
      thinking: request.thinking,
      reasoningEffort: request.reasoningEffort,
      currentMessageId: message.id,
      preferredSlideCount: request.slideCount,
      messages: () => {
        sync();
        return state.messages;
      },
      updatePart: (messageId, index, part) => {
        if (messageId === message.id) writer.update(index, part);
        else this.putPart(state, turn, messageId, index, part);
      },
      addDecks: (deckIds, primary) => {
        state.deckIds = [...new Set([...state.deckIds, ...deckIds])];
        if (primary) state.primaryDeckId = primary;
      },
      persist: async () => {
        signal.throwIfAborted();
        await turn.lease?.check();
        signal.throwIfAborted();
        sync();
        await this.save(state);
      },
    };
    const finishAnswer = async () => {
      usage.flush();
      if (status === 'streaming') status = 'done';
      const nested = status === 'failed' ? 'failed' : 'cancelled';
      for (let index = 0; index < writer.parts.length; index += 1) {
        const part = writer.parts[index];
        if (part?.type !== 'tool') continue;
        const closed = closeToolPart(
          part,
          'failed',
          part.status === 'running' ? (part.output ?? { error: 'Interrupted.' }) : part.output,
          nested,
        );
        if (closed !== part) writer.update(index, closed);
      }
      sync();
      try {
        await this.save(state);
      } catch (error) {
        status = 'failed';
        writer.show({
          type: 'error',
          message: 'Не удалось сохранить ответ. Обновите чат, чтобы проверить состояние операции.',
        });
        sync();
        turn.emit({ type: 'message', message: current() });
        throw error;
      }
      turn.emit({ type: 'message', message: current() });
    };
    try {
      await this.save(state);
      const agent = await this.loadAgent();
      const resolved = await this.resolvedChatModel(request, account);
      const effectiveRef = { connectionId: resolved.connectionId, modelId: resolved.model };
      scope = {
        ...scope,
        model: effectiveRef,
        ...(agent.promptsSha256
          ? {
              preparationManifest: {
                agentId: agent.agent.config.id,
                agentVersion: agent.agent.config.version,
                instructionsSha256: agent.promptsSha256,
                modelId: resolved.model,
                modelRevision: null,
                seed: 42,
              },
            }
          : {}),
      };
      let model: ChatModel | null = null;
      try {
        model = await this.chatModel(request, account, agent, resolved);
      } catch (error) {
        if (!prepared.approved) throw error;
        // An approved plan is built without the model; only the comment after it needs one.
      }
      if (prepared.approved) {
        if (!(await this.buildApproved(writer, scope, signal, prepared.approved))) {
          status = 'failed';
          return;
        }
        if (!model) return;
      }
      if (!model) return;
      sync();
      const editor = this.editor;
      const tools = chatTools(
        this.generation,
        scope,
        {
          run: async (question, sources, researchSignal) => {
            const researcher = await loadMaterialResearchAgent(this.generation.registryDir());
            const researchModel = await this.chatModel(request, account, {
              ...agent,
              agent: researcher,
            });
            researchSignal.throwIfAborted();
            return researchMaterials({
              question,
              sources,
              model: researchModel,
              agent: researcher,
              signal: researchSignal,
              seed: 42,
            });
          },
        },
        this.webDependency(request, account, agent),
        editor ? { loadSnapshot: (deckId, actor) => editor.load(deckId, actor) } : undefined,
      );
      // The agent tells the person whether the deck gets pictures, and does not promise them
      // when no image model is assigned.
      const imagesAvailable = await this.generation.imagesAvailable(account).catch(() => false);
      const projectTemplates = state.projectId
        ? await this.generation.projectTemplates(state.projectId, account)
        : [];
      const result = await runChatTurn({
        mode: request.mode,
        model,
        instructions: chatInstructions(agent, request.mode, {
          ...this.facts(state),
          currentAssistantMessageId: message.id,
          imagesAvailable,
          preferredSlideCount: request.slideCount,
          projectTemplates,
        }),
        history: modelHistory(
          state.messages
            .filter((item) => item.id !== message.id)
            .concat(writer.parts.length ? [current()] : []),
        ),
        tools,
        specs: toolSpecs(agent, tools),
        writer,
        signal,
        loopNudge: agent.loopNudge,
        maxSteps: 24,
        finalizeNudge: agent.finalizeNudge,
        onUsage: usage.report,
      });
      if (result.end === 'limit')
        throw new Error(
          'Достигнут предел шагов. Ответ не завершён; проверьте результаты перед продолжением.',
        );
      if (result.end === 'incomplete') {
        const explanations = {
          length: 'Модель достигла предела длины ответа.',
          content_filter: 'Провайдер остановил ответ.',
          protocol_error: 'Провайдер вернул неполный или повреждённый ответ.',
          interrupted: 'Соединение с моделью прервано.',
          loop: 'Повторяющийся ответ остановлен.',
          empty: 'Модель вернула пустой ответ.',
          context_budget:
            'Контекст превышает допустимый объём. Приложите материалы файлом или сократите запрос.',
        };
        throw new ModelRequestError(
          `${explanations[result.reason ?? 'protocol_error']} Ответ не завершён.`,
          {
            // A broken chunk or format is usually a one-off: the person may ask again.
            kind:
              result.reason === 'context_budget' || result.reason === 'length'
                ? 'context'
                : 'unavailable',
            modelId: model.model,
          },
        );
      }
      status = result.end === 'failed' ? 'failed' : 'done';
    } catch (error) {
      if (signal.aborted) status = 'cancelled';
      else {
        status = 'failed';
        this.logger.warn(
          `Chat ${state.id} turn failed: ${error instanceof Error ? error.message : error}`,
        );
        writer.show({
          type: 'error',
          message: (error instanceof Error ? error.message : 'Не удалось ответить.').slice(0, 2000),
          failure: {
            ...(request.model
              ? { modelId: request.model.modelId, connectionId: request.model.connectionId }
              : {}),
            ...modelFailureOf(error),
            ...(error instanceof ModelNotConfiguredError
              ? { kind: 'not-configured' as const }
              : {}),
          },
        });
      }
    } finally {
      await finishAnswer();
    }
  }

  /** Build an approved plan as the tool would, so the model reads it as its own call. */
  private async buildApproved(
    writer: AnswerWriter,
    scope: ChatToolScope,
    signal: AbortSignal,
    plan: ApprovedPlan,
  ): Promise<boolean> {
    const callId = `call-${crypto.randomUUID()}`;
    const startedAt = Date.now();
    const input = { templateId: plan.templateId, planId: plan.planId, brief: '', fileIds: [] };
    const part: Extract<ChatPart, { type: 'tool' }> = {
      type: 'tool',
      callId,
      name: 'build_deck',
      input,
      status: 'running',
      phase: 'executing',
      startedAt,
    };
    const index = writer.show(part);
    const fileIds = scope
      .messages()
      .flatMap((message) =>
        message.role === 'user'
          ? message.attachments.flatMap((item) => (item.kind === 'file' ? [item.fileId] : []))
          : [],
      );
    const activity = (item: ChatToolActivity) => {
      const live = writer.parts[index];
      if (live?.type !== 'tool') return;
      const merged = mergeToolActivity(live, item);
      if (merged) writer.update(index, merged);
    };
    try {
      const outcome = await runBuild(
        this.generation,
        scope,
        {
          signal,
          callId,
          show: (shown) => writer.show(shown),
          update: (at, shown) => writer.update(at, shown),
          activity,
        },
        {
          templateId: plan.templateId,
          planId: plan.planId,
          planRevision: plan.revision,
          outline: plan.outline,
          outlineSource: 'user',
          brief: '',
          fileIds: [...new Set(fileIds)].slice(0, 10),
        },
      );
      const live = writer.parts[index];
      const current = live?.type === 'tool' ? live : part;
      writer.update(
        index,
        closeToolPart(
          {
            ...current,
            input: {
              ...input,
              ...(current.input && typeof current.input === 'object' ? current.input : {}),
              fileIds,
            },
            phase: 'executing',
            startedAt: current.startedAt ?? startedAt,
          },
          outcome.failed ? 'failed' : 'done',
          outcome.output,
          outcome.failed ? 'failed' : 'cancelled',
        ),
      );
      return !outcome.failed;
    } catch (error) {
      const live = writer.parts[index];
      const current = live?.type === 'tool' ? live : part;
      writer.update(
        index,
        closeToolPart(
          current,
          'failed',
          { error: error instanceof Error ? error.message : 'The build failed.' },
          signal.aborted ? 'cancelled' : 'failed',
        ),
      );
      throw error;
    }
  }

  /** What the agent knows about the chat besides its messages, as data. */
  private facts(state: ChatState) {
    const plans = state.messages.flatMap((message) =>
      message.role === 'assistant'
        ? message.parts.flatMap((part) =>
            part.type === 'plan'
              ? [{ planId: part.planId, status: part.status, templateId: part.templateId }]
              : [],
          )
        : [],
    );
    return {
      today: new Date().toISOString().slice(0, 10),
      mode: state.mode,
      projectId: state.projectId,
      plans,
      preparation: readPreparation(state.messages),
      questionsAllowed: questionsAllowed(state.messages),
      evidenceMessages: state.messages.slice(-40).map((message) =>
        message.role === 'user'
          ? { messageId: message.id, role: message.role, preview: message.text.slice(0, 200) }
          : {
              messageId: message.id,
              role: message.role,
              callIds: message.parts.flatMap((part) =>
                part.type === 'tool' && part.status === 'done' ? [part.callId] : [],
              ),
            },
      ),
      builds: state.messages
        .flatMap((message) =>
          message.role === 'assistant'
            ? message.parts.flatMap((part) =>
                part.type === 'build'
                  ? [
                      {
                        buildId: part.buildId,
                        planId: part.planId,
                        runId: part.runId,
                        status: part.status,
                        active: part.status === 'preparing' || part.status === 'running',
                        error: part.error,
                      },
                    ]
                  : [],
              )
            : [],
        )
        .slice(-5),
      decks: state.deckIds,
      recommendedDeck: state.primaryDeckId,
    };
  }

  private readonly saving = new Map<string, Promise<void>>();
  private readonly pendingSave = new Set<string>();

  /** Write the chat down soon: a streaming answer changes it many times a second. */
  private saveSoon(state: ChatState): void {
    const turn = this.turns.get(state.id);
    if (!turn || turn.finished) return;
    if (this.pendingSave.has(state.id)) return;
    this.pendingSave.add(state.id);
    setTimeout(() => {
      this.pendingSave.delete(state.id);
      if (this.turns.get(state.id) !== turn || turn.finished) return;
      const answer = this.currentAnswer.get(state.id);
      answer?.();
      void this.save(state).catch((error: unknown) => {
        this.logger.error(
          `Chat ${state.id} could not save progress: ${error instanceof Error ? error.message : error}`,
        );
        turn.controller.abort(error);
      });
    }, SAVE_EVERY_MS);
  }

  /** Write the chat whole. Writes of one chat go one after another, the last one wins. */
  private save(state: ChatState): Promise<void> {
    const previous = this.saving.get(state.id) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const messages = JSON.stringify(state.messages);
        if (Buffer.byteLength(messages, 'utf8') > MAX_DOCUMENT_BYTES) {
          throw new BadRequestException('Chat document is too large to save.');
        }
        if (state.persisted) {
          const result = await this.pool.query(
            `UPDATE chats SET mode = $3, deck_ids = $4, primary_deck_id = $5,
                    messages = $6::jsonb, updated_at = now()
             WHERE id = $1 AND owner_id = $2`,
            [state.id, state.ownerId, state.mode, state.deckIds, state.primaryDeckId, messages],
          );
          if (!result.rowCount) throw new NotFoundException('Chat not found.');
          return;
        }
        const result = await this.pool.query(
          `INSERT INTO chats (id, owner_id, title, project_id, mode, deck_ids, primary_deck_id, messages, model)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
           ON CONFLICT (id) DO UPDATE SET
             mode = EXCLUDED.mode, deck_ids = EXCLUDED.deck_ids,
             primary_deck_id = EXCLUDED.primary_deck_id,
             messages = EXCLUDED.messages, updated_at = now()
           WHERE chats.owner_id = EXCLUDED.owner_id`,
          [
            state.id,
            state.ownerId,
            state.title,
            state.projectId,
            state.mode,
            state.deckIds,
            state.primaryDeckId,
            messages,
            JSON.stringify(state.initialModel ?? null),
          ],
        );
        if (!result.rowCount) throw new NotFoundException('Chat not found.');
        state.persisted = true;
      });
    this.saving.set(state.id, next);
    return next;
  }
}

/**
 * Attach the resolved connection to a model failure. The key and provider headers stay on the
 * inner model and are not part of this public surface.
 */
function withConnection(model: OpenAICompatibleChatModel, connectionId: string): ChatModel {
  return {
    model: model.model,
    get contextOverheadChars() {
      return model.contextOverheadChars;
    },
    async step(request) {
      try {
        return await model.step(request);
      } catch (error) {
        if (!(error instanceof ModelRequestError)) throw error;
        throw new ModelRequestError(error.message, { ...error.failure, connectionId });
      }
    },
  };
}

export type { Turn };
