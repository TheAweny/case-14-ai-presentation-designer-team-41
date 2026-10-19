import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_VERSION } from '../health/health.controller.js';
import { schemaAnchors } from './heading-anchor.js';
import { DOCS_TAGS } from './openapi.js';
import { openApiDocument } from './openapi-document.js';

interface SchemaObject {
  description?: string;
  type?: string;
  enum?: unknown[];
  items?: SchemaObject;
  properties?: Record<string, SchemaObject>;
  required?: string[];
  anyOf?: SchemaObject[];
  oneOf?: SchemaObject[];
  $ref?: string;
}

interface ParameterObject {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  $ref?: string;
}

interface OperationObject {
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: Array<ParameterObject | { $ref: string }>;
  requestBody?: { $ref?: string; content?: Record<string, { schema?: SchemaObject }> };
  responses?: Record<
    string,
    { $ref?: string; description?: string; content?: Record<string, { schema?: SchemaObject }> }
  >;
}

interface OpenAPIObject {
  paths: Record<
    string,
    Partial<
      Record<'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options', OperationObject>
    >
  >;
  tags?: Array<{ name: string; description?: string }>;
  components?: { schemas?: Record<string, SchemaObject> };
}

const TAG_SLUG: Record<string, string> = {
  Генерация: 'generation',
  Редактор: 'editor',
  'Файлы и шаблоны': 'files',
  Чаты: 'chats',
  Прогоны: 'runs',
  Библиотека: 'library',
  Модели: 'models',
  Пользователи: 'users',
  Вход: 'auth',
  Состояние: 'health',
};

const workspace = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const referenceDir = join(workspace, 'apps/docs/content/docs/api/reference');
const generatedJson = join(workspace, 'apps/docs/generated/openapi.json');
const publicJson = join(workspace, 'apps/docs/public/openapi.json');
let anchors = new Map<string, string>();

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}

function text(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function cell(value: string): string {
  return text(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function refName(schema: unknown): string | undefined {
  if (!schema || typeof schema !== 'object') return undefined;
  const ref = (schema as { $ref?: unknown }).$ref;
  if (typeof ref !== 'string' || !ref.startsWith('#/components/schemas/')) return undefined;
  return decodeURIComponent(ref.slice('#/components/schemas/'.length));
}

function schemaHref(name: string): string {
  const id = anchors.get(name) ?? name.toLowerCase();
  return `[${name}](/docs/api/reference/schemas/#${id})`;
}

function typeOf(schema: unknown): string {
  if (!schema || typeof schema !== 'object') return '';
  const named = refName(schema);
  if (named) return schemaHref(named);
  const record = schema as SchemaObject & { anyOf?: unknown[]; oneOf?: unknown[] };
  if (Array.isArray(record.enum))
    return record.enum.map((item) => `\`${String(item)}\``).join(', ');
  if (record.type === 'array') return `array&lt;${typeOf(record.items) || 'value'}&gt;`;
  if (Array.isArray(record.anyOf)) return record.anyOf.map(typeOf).filter(Boolean).join(' или ');
  if (Array.isArray(record.oneOf)) return record.oneOf.map(typeOf).filter(Boolean).join(' или ');
  return typeof record.type === 'string' ? record.type : '';
}

function schemaLink(schema: unknown): string {
  const named = refName(schema);
  if (named) return schemaHref(named);
  const kind = typeOf(schema);
  return kind || '—';
}

function operationsOf(document: OpenAPIObject): Array<{
  method: string;
  path: string;
  tag: string;
  operation: OperationObject;
}> {
  const rows: Array<{ method: string; path: string; tag: string; operation: OperationObject }> = [];
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const) {
      const operation = item[method];
      if (!operation) continue;
      rows.push({
        method: method.toUpperCase(),
        path,
        tag: operation.tags?.[0] ?? 'Прочее',
        operation,
      });
    }
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function parameters(operation: OperationObject): string {
  const rows = (operation.parameters ?? []).filter(
    (item): item is ParameterObject => !('$ref' in item),
  );
  if (rows.length === 0) return '';
  const body = [
    '### Параметры',
    '',
    '| Имя | Где | Обязателен | Описание |',
    '| --- | --- | --- | --- |',
    ...rows.map((row) => {
      const where = row.in;
      const required = row.required ? 'да' : 'нет';
      return `| \`${cell(row.name)}\` | ${cell(where)} | ${required} | ${cell(row.description ?? '')} |`;
    }),
    '',
  ];
  return body.join('\n');
}

function requestBody(operation: OperationObject): string {
  const body = operation.requestBody;
  if (!body || '$ref' in body) return '';
  const content = body.content ?? {};
  const lines = Object.entries(content).map(([mime, entry]) => {
    return `- \`${cell(mime)}\` — ${schemaLink(entry.schema)}`;
  });
  if (lines.length === 0) return '';
  return ['### Тело запроса', '', ...lines, ''].join('\n');
}

function responses(operation: OperationObject): string {
  const entries = Object.entries(operation.responses ?? {});
  if (entries.length === 0) return '';
  const lines = ['### Ответы', '', '| Код | Описание | Схема |', '| --- | --- | --- |'];
  for (const [status, response] of entries) {
    if ('$ref' in response) {
      lines.push(`| ${cell(status)} | ${schemaLink(response)} | — |`);
      continue;
    }
    const schema = Object.values(response.content ?? {})[0]?.schema;
    lines.push(
      `| ${cell(status)} | ${cell(response.description ?? '')} | ${schema ? schemaLink(schema) : '—'} |`,
    );
  }
  return [...lines, ''].join('\n');
}

function operationMarkdown(method: string, path: string, operation: OperationObject): string {
  const parts = [
    `## \`${method} ${path}\``,
    '',
    operation.summary ? `**${text(operation.summary)}**` : '',
    '',
    operation.description ? text(operation.description) : '',
    '',
    parameters(operation),
    requestBody(operation),
    responses(operation),
  ];
  return parts.filter((part) => part !== '').join('\n');
}

function frontmatter(title: string, description: string): string {
  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
    '---',
    '',
  ].join('\n');
}

const GENERATED =
  '> Файл сгенерирован командой `yarn nx run api:export-openapi` из декораторов API и Zod-схем. Вручную не редактируется.\n';

function writeReference(document: OpenAPIObject): void {
  anchors = schemaAnchors(Object.keys(document.components?.schemas ?? {}));
  rmSync(referenceDir, { recursive: true, force: true });
  mkdirSync(referenceDir, { recursive: true });
  const operations = operationsOf(document);
  const tags = Object.values(DOCS_TAGS);
  const pages = ['index', ...tags.map((tag) => TAG_SLUG[tag] ?? tag), 'schemas'];

  const index = [
    frontmatter(
      'Справочник маршрутов',
      'Маршруты и схемы, снятые с OpenAPI при сборке документации.',
    ),
    GENERATED,
    'Страницы ниже собраны из документа, который API строит из тех же Zod-схем и декораторов, что проверяют запросы. Живой сервер для чтения не нужен.',
    '',
    'Базовый адрес — API продукта, локально `http://localhost:3001`. Путь `/api/backend` есть только у приложения: на хосте документации его нет, и примеры его не используют.',
    '',
    'Маршруты диктовки `/speech` в этот документ не входят: у контроллера нет OpenAPI-декораторов.',
    '',
    '## Разделы',
    '',
    ...tags.map((tag) => {
      const count = operations.filter((row) => row.tag === tag).length;
      const description = document.tags?.find((item) => item.name === tag)?.description ?? '';
      return `- [${tag}](/docs/api/reference/${TAG_SLUG[tag]}/) — ${count}. ${text(description)}`;
    }),
    `- [Схемы](/docs/api/reference/schemas/) — ${Object.keys(document.components?.schemas ?? {}).length}.`,
    '',
  ].join('\n');
  writeFileSync(join(referenceDir, 'index.md'), index);

  for (const tag of tags) {
    const slug = TAG_SLUG[tag];
    if (!slug) continue;
    const description = document.tags?.find((item) => item.name === tag)?.description ?? tag;
    const body = operations
      .filter((row) => row.tag === tag)
      .map((row) => operationMarkdown(row.method, row.path, row.operation))
      .join('\n');
    writeFileSync(
      join(referenceDir, `${slug}.md`),
      `${frontmatter(tag, description)}\n${GENERATED}\n${text(description)}\n\n${body}`,
    );
  }

  const schemas = document.components?.schemas ?? {};
  const schemaBody = Object.keys(schemas)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => schemaSection(name, schemas[name] as SchemaObject))
    .join('\n');
  writeFileSync(
    join(referenceDir, 'schemas.md'),
    `${frontmatter('Схемы', 'Имена моделей из OpenAPI-документа API.')}\n${GENERATED}\n${schemaBody}`,
  );

  writeFileSync(
    join(referenceDir, 'meta.json'),
    `${JSON.stringify({ title: 'Справочник', pages }, null, 2)}\n`,
  );
}

function schemaSection(name: string, schema: SchemaObject | undefined): string {
  if (!schema) return `## ${name}\n`;
  const lines = [`## ${name}`, ''];
  if (schema.description) lines.push(text(schema.description), '');
  const kind = typeOf(schema);
  if (kind && !kind.startsWith('[')) lines.push(`Тип: \`${kind}\`.`, '');
  const properties = schema.properties ?? {};
  const names = Object.keys(properties);
  if (names.length > 0) {
    const required = new Set(schema.required ?? []);
    lines.push('| Поле | Тип | Обязательно | Описание |', '| --- | --- | --- | --- |');
    for (const property of names) {
      const value = properties[property] as SchemaObject | undefined;
      lines.push(
        `| \`${cell(property)}\` | ${value ? typeOf(value) || '—' : '—'} | ${required.has(property) ? 'да' : 'нет'} | ${cell(value?.description ?? '')} |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

const document = await openApiDocument(API_VERSION);
const portable = document as unknown as OpenAPIObject;
const json = `${JSON.stringify(sortValue(portable), null, 2)}\n`;
mkdirSync(dirname(generatedJson), { recursive: true });
mkdirSync(dirname(publicJson), { recursive: true });
writeFileSync(generatedJson, json);
writeFileSync(publicJson, json);
writeReference(portable);
process.stdout.write(`OpenAPI ${API_VERSION}: ${referenceDir}\n`);
