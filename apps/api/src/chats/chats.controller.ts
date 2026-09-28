import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Put,
  Query,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { CurrentAccount } from '../accounts/account.guard.js';
import type { Account } from '../accounts/account-rules.js';
import { LibraryMetadata } from '../generation/library-metadata.js';

const CHAT_ID = /^[0-9a-f-]{36}$/i;
const DECK_ID = /^run-[0-9a-f-]{36}$/i;
const TITLE_MAX_LENGTH = 200;
/** A chat is text and small previews; a document this large is a bug on the client. */
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

interface ChatRow {
  readonly id: string;
  readonly title: string;
  readonly project_id: string | null;
  readonly template_id: string | null;
  readonly deck_ids: string[];
  readonly primary_deck_id: string | null;
  readonly messages?: unknown;
  readonly conversation?: unknown;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface ChatSummary {
  readonly chatId: string;
  readonly title: string;
  readonly projectId: string | null;
  readonly templateId: string | null;
  readonly deckIds: readonly string[];
  /** The deck the chat leads to: the chosen variant, or the one the agent recommends. */
  readonly deckId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface ChatDocument extends ChatSummary {
  readonly messages: unknown;
  readonly conversation: unknown;
}

const SUMMARY_COLUMNS = `id, title, project_id, template_id, deck_ids,
  conversation->>'primaryDeckId' AS primary_deck_id, created_at, updated_at`;

function summaryOf(row: ChatRow): ChatSummary {
  return {
    chatId: row.id,
    title: row.title,
    projectId: row.project_id,
    templateId: row.template_id,
    deckIds: row.deck_ids,
    deckId:
      row.primary_deck_id !== null && row.deck_ids.includes(row.primary_deck_id)
        ? row.primary_deck_id
        : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function checkedTitle(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException('Chat title is required.');
  }
  return value.trim().slice(0, TITLE_MAX_LENGTH);
}

/**
 * Chats of the signed-in account. The web saves a chat whole (`PUT`) as the conversation goes on
 * and reads it back after a reload; the sidebar lists them. Another account's chat is answered as
 * missing. Deleting a chat deletes the decks it produced: the chat is how a person finds them.
 */
@Controller('chats')
export class ChatsController implements OnApplicationShutdown {
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });
  private readonly library = new LibraryMetadata(
    resolve(process.env.RUNS_DIR ?? join(process.cwd(), 'runs')),
  );

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }

  /** Chats, the latest first. `projectId` narrows to one project, `deckId` to the chat of a deck. */
  @Get()
  async list(
    @CurrentAccount() account: Account,
    @Query('projectId') projectId?: string,
    @Query('deckId') deckId?: string,
  ): Promise<readonly ChatSummary[]> {
    const result = await this.pool.query<ChatRow>(
      `SELECT ${SUMMARY_COLUMNS} FROM chats
       WHERE owner_id = $1
         AND ($2::text IS NULL OR project_id = $2)
         AND ($3::text IS NULL OR $3 = ANY(deck_ids))
       ORDER BY updated_at DESC`,
      [account.id, projectId ?? null, deckId ?? null],
    );
    return result.rows.map(summaryOf);
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentAccount() account: Account): Promise<ChatDocument> {
    const result = await this.pool.query<ChatRow>(
      `SELECT ${SUMMARY_COLUMNS}, messages, conversation FROM chats
       WHERE id = $1 AND owner_id = $2`,
      [id, account.id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Chat not found.');
    return { ...summaryOf(row), messages: row.messages, conversation: row.conversation ?? null };
  }

  /** Create the chat or replace it whole. The id is the client's, so saving is idempotent. */
  @Put(':id')
  async save(
    @Param('id') id: string,
    @Body()
    body: {
      title?: unknown;
      projectId?: unknown;
      templateId?: unknown;
      deckIds?: unknown;
      messages?: unknown;
      conversation?: unknown;
    },
    @CurrentAccount() account: Account,
  ): Promise<ChatSummary> {
    if (!CHAT_ID.test(id)) throw new BadRequestException('Invalid chat id.');
    const title = checkedTitle(body.title);
    if (body.projectId !== null && typeof body.projectId !== 'string') {
      throw new BadRequestException('projectId must be a string or null.');
    }
    if (body.templateId !== null && typeof body.templateId !== 'string') {
      throw new BadRequestException('templateId must be a string or null.');
    }
    if (
      !Array.isArray(body.deckIds) ||
      !body.deckIds.every((deckId) => typeof deckId === 'string' && DECK_ID.test(deckId))
    ) {
      throw new BadRequestException('deckIds must be a list of deck ids.');
    }
    if (!Array.isArray(body.messages)) throw new BadRequestException('messages must be a list.');
    const messages = JSON.stringify(body.messages);
    const conversation = body.conversation === undefined ? null : JSON.stringify(body.conversation);
    if (messages.length + (conversation?.length ?? 0) > MAX_DOCUMENT_BYTES) {
      throw new BadRequestException('The chat is too large to save.');
    }
    if (body.projectId !== null) {
      const project = await this.pool.query(
        'SELECT 1 FROM library_projects WHERE id = $1 AND owner_id = $2',
        [body.projectId, account.id],
      );
      if (!project.rowCount) throw new NotFoundException('Project not found.');
    }
    // Only the account's own decks are linked: a chat cannot claim someone else's.
    const deckIds: string[] = [];
    for (const deckId of body.deckIds as string[]) {
      if (await this.library.visible(deckId, account.id)) deckIds.push(deckId);
    }
    const result = await this.pool.query<ChatRow>(
      `INSERT INTO chats (id, owner_id, title, project_id, template_id, deck_ids, messages, conversation)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, project_id = EXCLUDED.project_id,
         template_id = EXCLUDED.template_id, deck_ids = EXCLUDED.deck_ids,
         messages = EXCLUDED.messages, conversation = EXCLUDED.conversation, updated_at = now()
       WHERE chats.owner_id = EXCLUDED.owner_id
       RETURNING ${SUMMARY_COLUMNS}`,
      [id, account.id, title, body.projectId, body.templateId, deckIds, messages, conversation],
    );
    const row = result.rows[0];
    // The id is someone else's chat: answered as if it did not exist.
    if (!row) throw new NotFoundException('Chat not found.');
    return summaryOf(row);
  }

  /**
   * Rename a chat or move it to another project (null: out of projects) from the sidebar menu.
   * Its decks move with it. Neither counts as an edit: the chat keeps its place in the history.
   */
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { title?: unknown; projectId?: unknown },
    @CurrentAccount() account: Account,
  ): Promise<ChatSummary> {
    const title = body.title === undefined ? null : checkedTitle(body.title);
    const moves = body.projectId !== undefined;
    if (moves && body.projectId !== null && typeof body.projectId !== 'string') {
      throw new BadRequestException('projectId must be a string or null.');
    }
    if (typeof body.projectId === 'string') {
      const project = await this.pool.query(
        'SELECT 1 FROM library_projects WHERE id = $1 AND owner_id = $2',
        [body.projectId, account.id],
      );
      if (!project.rowCount) throw new NotFoundException('Project not found.');
    }
    const result = await this.pool.query<ChatRow>(
      `UPDATE chats SET title = COALESCE($3, title),
              project_id = CASE WHEN $4::boolean THEN $5 ELSE project_id END
       WHERE id = $1 AND owner_id = $2 RETURNING ${SUMMARY_COLUMNS}`,
      [id, account.id, title, moves, moves ? body.projectId : null],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Chat not found.');
    if (moves) {
      for (const deckId of row.deck_ids) {
        if (await this.library.visible(deckId, account.id)) {
          await this.library.patch(deckId, { projectId: row.project_id });
        }
      }
    }
    return summaryOf(row);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentAccount() account: Account): Promise<void> {
    const result = await this.pool.query<{ deck_ids: string[] }>(
      'DELETE FROM chats WHERE id = $1 AND owner_id = $2 RETURNING deck_ids',
      [id, account.id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Chat not found.');
    for (const deckId of row.deck_ids) {
      if (await this.library.visible(deckId, account.id)) await this.library.remove(deckId);
    }
  }
}
