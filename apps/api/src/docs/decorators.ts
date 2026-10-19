import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { DOCS_TAGS, bodyReference } from './openapi.js';
import { apiErrorSchema } from './schemas.js';

/** Errors as the OpenAPI document lists them; the text is what the status means on this API. */
const ERRORS = {
  400: ['Неверный запрос: тело или параметры не прошли проверку.', 'Bad Request'],
  401: ['Нет входа: аккаунт не назван, удалён или отключён.', 'Unauthorized'],
  403: ['Нет прав: запрос не от веб-сервера или действие только для администратора.', 'Forbidden'],
  404: ['Объекта нет или он принадлежит другому аккаунту.', 'Not Found'],
  409: ['Конфликт состояния: действие сейчас невозможно.', 'Conflict'],
  422: ['Движок не смог прочитать файл.', 'Unprocessable Entity'],
  429: ['Слишком много попыток. Повторите запрос позже.', 'Too Many Requests'],
  503: ['Недоступен движок, база данных или хранилище ключей.', 'Service Unavailable'],
  504: ['Движок не ответил вовремя.', 'Gateway Timeout'],
} as const;

export type ErrorStatus = keyof typeof ERRORS;

export function ApiErrors(...statuses: ErrorStatus[]) {
  return applyDecorators(
    ...statuses.map((status) => {
      const [description, error] = ERRORS[status];
      return ApiResponse({
        status,
        description,
        standardSchema: apiErrorSchema,
        example: { statusCode: status, message: description, error },
      });
    }),
  );
}

/** A controller of the signed-in account: its tag, and the refusals every such route shares. */
export function ApiAccountRoutes(tag: keyof typeof DOCS_TAGS) {
  return applyDecorators(
    ApiTags(DOCS_TAGS[tag]),
    ApiErrors(401, 403),
    ApiHeader({
      name: 'x-lct-session',
      required: true,
      description:
        'Серверный session token из /auth/verify. Отзывается при logout и изменении доступа.',
    }),
  );
}

/** A JSON body described by a Zod schema, with examples named by what they show. */
export function ApiJsonBody(schema: z.ZodType, examples: Record<string, unknown> = {}) {
  return ApiBody({
    schema: bodyReference(schema),
    examples: Object.fromEntries(
      Object.entries(examples).map(([summary, value]) => [summary, { summary, value }]),
    ),
  });
}

/** A route that answers a file rather than JSON. */
export function ApiFile(description: string, ...types: string[]) {
  return applyDecorators(
    ApiProduces(...types),
    ApiResponse({
      status: 200,
      description,
      content: Object.fromEntries(
        types.map((type) => [type, { schema: { type: 'string', format: 'binary' } }]),
      ),
    }),
  );
}
