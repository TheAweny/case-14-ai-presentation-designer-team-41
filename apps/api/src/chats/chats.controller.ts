import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  chatTurnRequestSchema,
  type ChatDocument,
  type ChatEvent,
  type ChatSummary,
} from '@lct/contracts';
import { CurrentAccount } from '../accounts/account.guard.js';
import type { Account } from '../accounts/account-rules.js';
import { ChatsService, type Turn } from './chats.service.js';

/** The part of the HTTP response a stream of events writes to. */
interface EventStream {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
  flushHeaders(): void;
  write(chunk: string): boolean;
  end(): void;
  on(event: 'close', listener: () => void): unknown;
}

/** An idle stream is pinged, so proxies between the web and the API keep it open. */
const PING_EVERY_MS = 15000;

/**
 * Chats of the signed-in account. `POST /chats/:id/turns` sends a message and streams the agent's
 * answer back as server-sent events; `GET /chats/:id/stream` picks up a turn still running after
 * a reload. The sidebar lists chats, the chat page reads one whole.
 */
@Controller('chats')
export class ChatsController {
  constructor(@Inject(ChatsService) private readonly chats: ChatsService) {}

  /** Chats, the latest first. `projectId` narrows to one project, `deckId` to the chat of a deck. */
  @Get()
  list(
    @CurrentAccount() account: Account,
    @Query('projectId') projectId?: string,
    @Query('deckId') deckId?: string,
  ): Promise<ChatSummary[]> {
    return this.chats.list(account, {
      ...(projectId ? { projectId } : {}),
      ...(deckId ? { deckId } : {}),
    });
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentAccount() account: Account): Promise<ChatDocument> {
    return this.chats.get(id, account);
  }

  /** Send a turn and stream the answer. The turn goes on if the stream is closed. */
  @Post(':id/turns')
  async turn(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAccount() account: Account,
    @Res() response: EventStream,
  ): Promise<void> {
    const parsed = chatTurnRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const turn = await this.chats.startTurn(id, parsed.data, account);
    this.stream(turn, response, null, true);
  }

  /**
   * Watch the turn running in a chat: first the answer as it stands, then its events. With no
   * turn running the stream ends at once.
   */
  @Get(':id/stream')
  async watch(
    @Param('id') id: string,
    @CurrentAccount() account: Account,
    @Res() response: EventStream,
  ): Promise<void> {
    const turn = await this.chats.attach(id, account);
    const answer = this.chats.currentAnswer.get(id)?.() ?? null;
    this.stream(
      turn,
      response,
      answer ? { type: 'message', seq: -1, message: answer } : null,
      false,
    );
  }

  @Post(':id/cancel')
  @HttpCode(204)
  async cancel(@Param('id') id: string, @CurrentAccount() account: Account): Promise<void> {
    await this.chats.cancel(id, account);
  }

  /**
   * Rename a chat, move it to another project (null: out of projects) from the sidebar menu, or
   * pick the variant it leads to from its result.
   */
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { title?: unknown; projectId?: unknown; deckId?: unknown },
    @CurrentAccount() account: Account,
  ): Promise<ChatSummary> {
    return this.chats.update(id, body ?? {}, account);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentAccount() account: Account): Promise<void> {
    return this.chats.remove(id, account);
  }

  private stream(
    turn: Turn | null,
    response: EventStream,
    first: ChatEvent | null,
    fromStart: boolean,
  ): void {
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    const send = (event: ChatEvent) => response.write(`data: ${JSON.stringify(event)}\n\n`);
    if (first) send(first);
    if (!turn || (turn.finished && !fromStart)) {
      send({ type: 'turn-end', seq: 0 });
      response.end();
      return;
    }
    const ping = setInterval(() => turn.emit({ type: 'ping' }), PING_EVERY_MS);
    // A finished turn replays its events to the end at once, inside `watch`.
    let ended = false;
    const stop = turn.watch((event) => {
      if (ended) return;
      send(event);
      if (event.type !== 'turn-end') return;
      ended = true;
      clearInterval(ping);
      response.end();
    }, fromStart);
    if (ended) stop();
    response.on('close', () => {
      ended = true;
      clearInterval(ping);
      stop();
    });
  }
}
