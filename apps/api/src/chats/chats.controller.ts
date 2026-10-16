import {
  applyDecorators,
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
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  chatDocumentSchema,
  chatPartSchema,
  chatSummarySchema,
  chatTurnRequestSchema,
  type ChatDocument,
  type ChatEvent,
  type ChatSummary,
} from '@lct/contracts';
import { CurrentAccount } from '../accounts/account.guard.js';
import type { Account } from '../accounts/account-rules.js';
import { ChatsService, type Turn } from './chats.service.js';
import { ApiAccountRoutes, ApiErrors, ApiJsonBody } from '../docs/decorators.js';
import { chatPatchSchema, retryVariantSchema } from '../docs/schemas.js';

const CHAT_ID = '5b8e2f4a-1c3d-4e6f-9a7b-0c2d4e6f8a1b';
const chatParam = ApiParam({ name: 'id', description: 'id чата (UUID).', example: CHAT_ID });
const CHAT_EXAMPLE = {
  chatId: CHAT_ID,
  title: 'Итоги квартала для совета директоров',
  projectId: null,
  deckIds: ['run-0b6f4c1e-8d2a-4f7b-9c3e-5a1d7e9f2b40'],
  deckId: 'run-0b6f4c1e-8d2a-4f7b-9c3e-5a1d7e9f2b40',
  mode: 'auto',
  createdAt: '2026-10-16T10:00:00.000Z',
  updatedAt: '2026-10-16T10:04:12.000Z',
};

/** A stream of `ChatEvent`s, one per `data:` line. */
function ApiEventStream(description: string) {
  return applyDecorators(
    ApiProduces('text/event-stream'),
    ApiOkResponse({
      description: `${description} Каждое событие — строка \`data: <ChatEvent JSON>\`; поток закрывает \`turn-end\`.`,
      content: {
        'text/event-stream': {
          schema: { type: 'string' },
          example:
            'data: {"type":"text-delta","seq":4,"messageId":"…","index":0,"delta":"Собираю план"}\n\n' +
            'data: {"type":"turn-end","seq":9}\n\n',
        },
      },
    }),
  );
}

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
@ApiAccountRoutes('chats')
export class ChatsController {
  constructor(@Inject(ChatsService) private readonly chats: ChatsService) {}

  /** Chats, the latest first. `projectId` narrows to one project, `deckId` to the chat of a deck. */
  @Get()
  @ApiOperation({ summary: 'Чаты', description: 'Новые сверху.' })
  @ApiQuery({ name: 'projectId', required: false, description: 'Только чаты проекта.' })
  @ApiQuery({ name: 'deckId', required: false, description: 'Чат, в котором собрана колода.' })
  @ApiOkResponse({ standardSchema: z.array(chatSummarySchema), example: [CHAT_EXAMPLE] })
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
  @ApiOperation({ summary: 'Чат целиком', description: 'Все сообщения и идёт ли сейчас ответ.' })
  @chatParam
  @ApiOkResponse({ standardSchema: chatDocumentSchema })
  @ApiErrors(404)
  get(@Param('id') id: string, @CurrentAccount() account: Account): Promise<ChatDocument> {
    return this.chats.get(id, account);
  }

  /** Send a turn and stream the answer. The turn goes on if the stream is closed. */
  @Post(':id/turns')
  @ApiOperation({
    summary: 'Отправить ход и получить ответ потоком',
    description:
      'Сообщение, ответ на вопрос агента или одобренный план. Чата с таким id ещё нет — он создаётся. Ответ идёт потоком; если поток закрыть, ход продолжится.',
  })
  @chatParam
  @ApiJsonBody(chatTurnRequestSchema, {
    Сообщение: {
      mode: 'auto',
      input: {
        type: 'message',
        text: 'Собери презентацию по итогам квартала на 12 слайдов, акцент на выручке и оттоке.',
        attachments: [
          {
            kind: 'template',
            templateId: '11d8fefa-d032-4a95-84e5-77efd69569c2',
            name: 'VK Tech шаблон',
          },
        ],
      },
    },
  })
  @ApiEventStream('События хода.')
  @ApiErrors(400, 404, 409)
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
  @ApiOperation({
    summary: 'Подключиться к идущему ходу',
    description:
      'После перезагрузки страницы: сначала ответ как он есть, затем новые события. Хода нет — поток сразу закрывается.',
  })
  @chatParam
  @ApiEventStream('События идущего хода.')
  @ApiErrors(404)
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

  /** Build again a variant of a build in the chat that failed; answers the build's result. */
  @Post(':id/variants/retry')
  @ApiOperation({
    summary: 'Пересобрать упавший вариант',
    description: 'По плану, который сохранила сборка. Отвечает обновлённой карточкой результата.',
  })
  @chatParam
  @ApiJsonBody(retryVariantSchema, {
    'Вариант airy': { buildId: 'run-0b6f4c1e-8d2a-4f7b-9c3e-5a1d7e9f2b40', variant: 'airy' },
  })
  @ApiCreatedResponse({ standardSchema: chatPartSchema })
  @ApiErrors(400, 404, 409)
  retryVariant(
    @Param('id') id: string,
    @Body() body: { buildId?: unknown; variant?: unknown },
    @CurrentAccount() account: Account,
  ) {
    return this.chats.retryVariant(id, body ?? {}, account);
  }

  @Post(':id/cancel')
  @HttpCode(204)
  @ApiOperation({ summary: 'Остановить ход' })
  @chatParam
  @ApiNoContentResponse({ description: 'Ход остановлен или уже закончился.' })
  @ApiErrors(404)
  async cancel(@Param('id') id: string, @CurrentAccount() account: Account): Promise<void> {
    await this.chats.cancel(id, account);
  }

  /**
   * Rename a chat, move it to another project (null: out of projects) from the sidebar menu, or
   * pick the variant it leads to from its result.
   */
  @Patch(':id')
  @ApiOperation({
    summary: 'Переименовать, перенести или выбрать вариант',
    description:
      '`projectId: null` выносит чат из проекта; `deckId` — вариант, к которому ведёт чат.',
  })
  @chatParam
  @ApiJsonBody(chatPatchSchema, {
    Переименовать: { title: 'Итоги Q3' },
    'Выбрать вариант': { deckId: 'run-9c1d3f5b-7a9e-4c2d-b4f6-8e0a2c4e6f8b' },
  })
  @ApiOkResponse({ standardSchema: chatSummarySchema, example: CHAT_EXAMPLE })
  @ApiErrors(400, 404)
  update(
    @Param('id') id: string,
    @Body() body: { title?: unknown; projectId?: unknown; deckId?: unknown },
    @CurrentAccount() account: Account,
  ): Promise<ChatSummary> {
    return this.chats.update(id, body ?? {}, account);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить чат' })
  @chatParam
  @ApiNoContentResponse({ description: 'Чат удалён, вместе с его колодами.' })
  @ApiErrors(404)
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
