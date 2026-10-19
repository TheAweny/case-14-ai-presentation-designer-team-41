import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
  type SchemaObject,
  type StandardSchemaConversionResult,
} from '@nestjs/swagger';
import * as contracts from '@lct/contracts';
import { z } from 'zod';
import { SERVICE_TOKEN_HEADER, USER_HEADER } from '../auth/service-token.guard.js';
import * as apiSchemas from './schemas.js';

/**
 * The OpenAPI document of the API. Request and answer schemas are the Zod schemas the routes
 * already use (`@lct/contracts`, and `./schemas.ts` for the API's own answers): the document is
 * built from them at start, so it cannot drift from the code.
 *
 * The API serves only the JSON, at `/docs-json`. Like `/health` it needs no service token: it
 * describes routes and holds no data. The page people open is the web's `/api/docs`, drawn in the
 * interface's own theme.
 */

export const OPENAPI_JSON_PATH = '/docs-json';

export const DOCS_TAGS = {
  generation: 'Генерация',
  editor: 'Редактор',
  files: 'Файлы и шаблоны',
  chats: 'Чаты',
  runs: 'Прогоны',
  library: 'Библиотека',
  models: 'Модели',
  users: 'Пользователи',
  auth: 'Вход',
  health: 'Состояние',
} as const;

const TAG_DESCRIPTIONS: Record<keyof typeof DOCS_TAGS, string> = {
  generation:
    'Подготовка шаблона, сборка трёх вариантов колоды, редактор и экспорт в PPTX, PDF, PNG и HTML.',
  editor:
    'Серверные снимки колоды из редактора: редакция, картинки и экспорт зафиксированной редакции.',
  files: 'Загрузка шаблона `.pptx`/`.potx` и материалов; библиотека шаблонов и их превью.',
  chats: 'Разговор с ассистентом: ход отвечает потоком server-sent events.',
  runs: 'Состояние прогона и журнал его событий по этапам пайплайна.',
  library: 'Проекты: папки для колод, чатов и шаблонов.',
  models: 'Подключения к моделям и выбор модели для каждой роли пайплайна. Ключи наружу не уходят.',
  users: 'Свой профиль и управление аккаунтами для администратора.',
  auth: 'Проверка пароля для веб-сервера, который держит сессию.',
  health: 'Живы ли API, движок и база данных.',
};

/** One sentence. The pipeline, access and errors live on the web's guide pages. */
const DESCRIPTION =
  'Схемы запросов и ответов собраны из тех же Zod-контрактов, что проверяют данные в коде.';

/** Every contract schema under its name: `contractRegistry` names first, then the exports. */
function schemaNames(): Map<unknown, string> {
  const names = new Map<unknown, string>();
  const add = (name: string, schema: unknown) => {
    if (schema instanceof z.ZodType && !names.has(schema)) names.set(schema, name);
  };
  for (const [name, schema] of Object.entries(contracts.contractRegistry)) add(name, schema);
  for (const source of [contracts, apiSchemas]) {
    for (const [name, schema] of Object.entries(source)) {
      if (name.endsWith('Schema')) add(`${name[0]?.toUpperCase()}${name.slice(1, -6)}`, schema);
    }
  }
  return names;
}

let names: Map<unknown, string> | undefined;
function nameOf(schema: unknown): string | undefined {
  names ??= schemaNames();
  return names.get(schema);
}

/**
 * Turns a Zod schema into OpenAPI, with every named schema it meets moved to
 * `components.schemas`. Zod reads metadata only through `get`, so the names are laid over the
 * global registry instead of written into it: the pipeline converts the same schemas for model
 * prompts and must keep getting them inline.
 */
const metadata = {
  get(schema: z.core.$ZodType) {
    const meta = z.globalRegistry.get(schema);
    const id = nameOf(schema);
    return id === undefined ? meta : { ...meta, id };
  },
} as unknown as z.core.$ZodRegistry<z.core.GlobalMeta>;

export function convertSchema(
  schema: unknown,
  { schemaType }: { schemaType: 'input' | 'output' },
): StandardSchemaConversionResult | undefined {
  if (!(schema instanceof z.ZodType)) return undefined;
  const { definitions, ...root } = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    metadata,
    io: schemaType,
    unrepresentable: 'any',
  }) as { definitions?: Record<string, unknown> } & Record<string, unknown>;
  return { schema: root, components: definitions ?? {} };
}

/**
 * Request bodies, by the schema each is described with. `@ApiBody` takes a reference, not a Zod
 * schema, so the bodies are collected here and their schemas added to the document as it is built.
 */
const bodies = new Set<z.ZodType>();

export function bodyReference(schema: z.ZodType): { $ref: string } {
  const name = nameOf(schema);
  if (name === undefined) {
    throw new Error(
      'A request body schema needs a name: export it as `…Schema` from docs/schemas.ts.',
    );
  }
  bodies.add(schema);
  return { $ref: `#/components/schemas/${name}` };
}

/** The body schemas with their references pointed at `components`, as the routes' ones are. */
function bodyComponents(): Record<string, SchemaObject> {
  const components: Record<string, unknown> = {};
  for (const schema of bodies)
    Object.assign(components, convertSchema(schema, { schemaType: 'input' })?.components);
  return JSON.parse(
    JSON.stringify(components).replaceAll('"#/definitions/', '"#/components/schemas/'),
  ) as Record<string, SchemaObject>;
}

const SUCCESS: Record<string, string> = {
  '200': 'Успешно.',
  '201': 'Создано или запущено.',
  '202': 'Принято.',
  '204': 'Готово, тела нет.',
};

export function buildOpenApiDocument(app: INestApplication, version: string): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle('Цифровой дизайнер презентаций — API')
    .setDescription(DESCRIPTION)
    .setVersion(version)
    .setLicense('Apache-2.0', 'https://www.apache.org/licenses/LICENSE-2.0')
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: SERVICE_TOKEN_HEADER,
        description: 'Общий секрет веб-сервера и API (`API_SERVICE_TOKEN`). Браузер его не видит.',
      },
      'serviceToken',
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: USER_HEADER,
        description: 'id вошедшего аккаунта. Веб-сервер берёт его из сессии.',
      },
      'account',
    )
    .addSecurityRequirements({ serviceToken: [], account: [] });
  for (const [key, name] of Object.entries(DOCS_TAGS)) {
    builder.addTag(name, TAG_DESCRIPTIONS[key as keyof typeof DOCS_TAGS]);
  }
  const document = SwaggerModule.createDocument(app, builder.build(), {
    standardSchemaConverter: convertSchema,
    // `chats.list`: Swagger UI links to an operation by its id, and reads `_` there as a space.
    operationIdFactory: (controller, method) =>
      `${controller[0]?.toLowerCase()}${controller.slice(1).replace(/Controller$/, '')}.${method}`,
  });
  // Schemas the answers brought stay as Nest wrote them; bodies add only what is missing.
  document.components = {
    ...document.components,
    schemas: { ...bodyComponents(), ...document.components?.schemas },
  };
  // A success answer left without words reads as a blank cell on the page.
  for (const item of Object.values(document.paths)) {
    for (const operation of Object.values(item)) {
      const responses = (operation as { responses?: Record<string, { description?: string }> })
        .responses;
      for (const [status, response] of Object.entries(responses ?? {})) {
        if (!response.description) response.description = SUCCESS[status] ?? 'Успешно.';
      }
    }
  }
  return document;
}

/** Serves the document as JSON at `/docs-json`; the page itself is the web's. */
export function setupOpenApi(app: INestApplication, version: string): void {
  const document = buildOpenApiDocument(app, version);
  SwaggerModule.setup('docs', app, document, {
    ui: false,
    raw: ['json'],
    jsonDocumentUrl: OPENAPI_JSON_PATH,
  });
}
