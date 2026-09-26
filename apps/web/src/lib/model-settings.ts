import { z } from 'zod';

/**
 * Настройки моделей: подключения к OpenAI-совместимым серверам и то, какая модель выполняет
 * каждую роль пайплайна. Где будут работать модели — на локальной видеокарте, в облаке или на
 * нескольких серверах сразу, — заранее неизвестно, поэтому продукт даёт подключить любой такой
 * сервер и назначить его модели ролям.
 *
 * Все обращения к моделям идут с сервера приложения, поэтому и настройки живут там: браузер
 * видит только, задан ли ключ, и его последние символы (`hasKey`, `keyHint`), но не сам ключ.
 *
 * Схемы лежат здесь, пока API не описывает настройки. Когда опишет, они переедут в
 * `packages/contracts`, как остальные контракты, а этот модуль оставит себе только проверки ввода.
 *
 * Модуль без React и DOM: правила ввода и классификация адресов проверяются тестами.
 */

/** Роли пайплайна из `docs/MODELS.md`, в порядке, в котором они работают над колодой. */
export const PIPELINE_ROLES = ['planner', 'writer', 'critic', 'vision', 'image'] as const;
export const PipelineRoleSchema = z.enum(PIPELINE_ROLES);
export type PipelineRole = z.infer<typeof PipelineRoleSchema>;

/**
 * Какая модель нужна роли. По ответу `/models` тип не определить — сервер отдаёт только id, —
 * поэтому это подсказка человеку, а не проверка.
 */
export type ModelKind = 'llm' | 'vlm' | 'text-to-image';

export const ROLE_MODEL_KIND: Readonly<Record<PipelineRole, ModelKind>> = {
  planner: 'llm',
  writer: 'llm',
  critic: 'llm',
  vision: 'vlm',
  image: 'text-to-image',
};

/**
 * Можно ли роль выключить. Без иллюстратора колода собирается — картинки берутся из контент-пака
 * или не рисуются; без плана, текстов, аудита и визуальной проверки — нет.
 */
export function isRoleOptional(role: PipelineRole): boolean {
  return role === 'image';
}

/**
 * Откуда начали подключение. Пресет только подставляет адрес и имя: дальше это обычный
 * OpenAI-совместимый сервер. Облачных адресов среди пресетов нет — облако подключают как
 * `custom`, со своим адресом.
 */
export const CONNECTION_PRESETS = ['ollama', 'lm-studio', 'vllm', 'custom'] as const;
export const ConnectionPresetSchema = z.enum(CONNECTION_PRESETS);
export type ConnectionPreset = z.infer<typeof ConnectionPresetSchema>;

/** Адрес по умолчанию: стандартный порт каждого рантайма и его OpenAI-совместимый префикс. */
export const PRESET_BASE_URLS: Readonly<Record<ConnectionPreset, string>> = {
  ollama: 'http://localhost:11434/v1',
  'lm-studio': 'http://localhost:1234/v1',
  vllm: 'http://localhost:8000/v1',
  custom: '',
};

/** Имя по умолчанию — название рантайма; у своего сервера имени нет, его придумывает человек. */
export const PRESET_NAMES: Readonly<Record<ConnectionPreset, string>> = {
  ollama: 'Ollama',
  'lm-studio': 'LM Studio',
  vllm: 'vLLM',
  custom: '',
};

export const CONNECTION_NAME_MAX_LENGTH = 60;
export const BASE_URL_MAX_LENGTH = 2048;
export const API_KEY_MAX_LENGTH = 512;
export const MODEL_ID_MAX_LENGTH = 256;
/** Сколько моделей из ответа сервера запоминаем: больше в меню роли всё равно не выбрать. */
export const MODEL_LIST_MAX_LENGTH = 500;

/**
 * Почему проверка не прошла. Каждый вид человек чинит по-своему: недоступен — запустить сервер или
 * поправить адрес, 401/403 — ключ, чужой формат — адрес указывает не на OpenAI-совместимый API.
 */
export const CheckErrorSchema = z.discriminatedUnion('kind', [
  /** Соединение не установилось: сервер не запущен, не тот порт или имя не разрешилось. */
  z.object({ kind: z.literal('unreachable'), detail: z.string().max(200).nullable() }),
  /** Сервер отказал в доступе: ключ неверный или не задан. */
  z.object({ kind: z.literal('unauthorized'), status: z.number().int() }),
  /** Сервер ответил другой ошибкой: 404 — обычно в адресе не хватает `/v1`. */
  z.object({ kind: z.literal('http'), status: z.number().int() }),
  /** Ответ пришёл, но это не список моделей в формате OpenAI. */
  z.object({ kind: z.literal('invalid-response') }),
  /** Сервер не ответил за отведённое время. */
  z.object({ kind: z.literal('timeout') }),
]);
export type CheckError = z.infer<typeof CheckErrorSchema>;

const ModelIdSchema = z.string().trim().min(1).max(MODEL_ID_MAX_LENGTH);

/** Итог последней проверки: когда, и либо найденные модели, либо причина отказа. */
export const ConnectionCheckSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    at: z.iso.datetime(),
    models: z.array(ModelIdSchema).max(MODEL_LIST_MAX_LENGTH),
  }),
  z.object({ ok: z.literal(false), at: z.iso.datetime(), error: CheckErrorSchema }),
]);
export type ConnectionCheck = z.infer<typeof ConnectionCheckSchema>;

/** Подключение, каким его видит браузер: без ключа, только признак и последние символы. */
export const ModelConnectionSchema = z.object({
  connectionId: z.string().min(1),
  name: z.string(),
  preset: ConnectionPresetSchema,
  baseUrl: z.string(),
  hasKey: z.boolean(),
  /** Последние символы ключа, чтобы отличить один ключ от другого; у короткого ключа — null. */
  keyHint: z.string().nullable(),
  /** null — подключение ещё не проверяли. */
  lastCheck: ConnectionCheckSchema.nullable(),
});
export type ModelConnection = z.infer<typeof ModelConnectionSchema>;

/**
 * Кто выполняет роль: модель на подключении, никто (роль выключена — только у необязательных) или
 * пока не назначено.
 */
export const RoleAssignmentSchema = z.discriminatedUnion('kind', [
  z.object({
    role: PipelineRoleSchema,
    kind: z.literal('model'),
    connectionId: z.string().min(1),
    modelId: ModelIdSchema,
  }),
  z.object({ role: PipelineRoleSchema, kind: z.literal('disabled') }),
  z.object({ role: PipelineRoleSchema, kind: z.literal('unassigned') }),
]);
export type RoleAssignment = z.infer<typeof RoleAssignmentSchema>;

/** Все настройки моделей. В `roles` каждая роль ровно один раз, в порядке `PIPELINE_ROLES`. */
export const ModelSettingsSchema = z.object({
  connections: z.array(ModelConnectionSchema),
  roles: z.array(RoleAssignmentSchema),
});
export type ModelSettings = z.infer<typeof ModelSettingsSchema>;

/**
 * Что человек ввёл в форме подключения. Без `connectionId` — новое подключение, с ним — правка.
 * Пустой `apiKey` при правке ключ не стирает: поле ключа в форме всегда пустое, сам ключ в
 * браузер не приходит.
 *
 * `lastCheck` — проверка, которую форма сделала перед сохранением, для тех же адреса и ключа:
 * так список моделей появляется в ролях сразу, без второго запроса к серверу.
 */
export const ConnectionInputSchema = z.object({
  connectionId: z.string().min(1).optional(),
  name: z.string().max(CONNECTION_NAME_MAX_LENGTH * 4),
  preset: ConnectionPresetSchema,
  baseUrl: z.string().max(BASE_URL_MAX_LENGTH * 2),
  apiKey: z
    .string()
    .max(API_KEY_MAX_LENGTH * 2)
    .optional(),
  lastCheck: ConnectionCheckSchema.nullable().optional(),
});
export type ConnectionInput = z.infer<typeof ConnectionInputSchema>;

/**
 * Проверка ещё не сохранённого подключения. `connectionId` — при правке: если ключ в форме не
 * вводили, берётся сохранённый.
 */
export const ProbeInputSchema = z.object({
  connectionId: z.string().min(1).optional(),
  baseUrl: z.string().max(BASE_URL_MAX_LENGTH * 2),
  apiKey: z
    .string()
    .max(API_KEY_MAX_LENGTH * 2)
    .optional(),
});
export type ProbeInput = z.infer<typeof ProbeInputSchema>;

// Проверки ввода. Каждая возвращает причину, а не текст: слова живут в словаре интерфейса.

export type ConnectionNameProblem = 'empty' | 'tooLong';

export function connectionNameProblem(name: string): ConnectionNameProblem | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'empty';
  if (trimmed.length > CONNECTION_NAME_MAX_LENGTH) return 'tooLong';
  return null;
}

/**
 * `credentials` — логин и пароль в самом адресе (`https://user:pass@host`): так их увидел бы
 * каждый, кто видит адрес, а ключу место в поле ключа.
 */
export type BaseUrlProblem = 'empty' | 'tooLong' | 'invalid' | 'protocol' | 'credentials';

export function baseUrlProblem(value: string): BaseUrlProblem | null {
  const trimmed = value.trim();
  if (trimmed === '') return 'empty';
  if (trimmed.length > BASE_URL_MAX_LENGTH) return 'tooLong';
  // «localhost:11434/v1» без схемы — самая частая ошибка: говорим о схеме, а не «неверный адрес».
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) return 'protocol';
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return 'invalid';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'protocol';
  if (url.hostname === '') return 'invalid';
  if (url.username !== '' || url.password !== '') return 'credentials';
  return null;
}

/** `whitespace` — пробел или перенос внутри ключа: так бывает, когда ключ скопировали с лишним. */
export type ApiKeyProblem = 'tooLong' | 'whitespace';

export function apiKeyProblem(key: string): ApiKeyProblem | null {
  const trimmed = key.trim();
  if (trimmed.length > API_KEY_MAX_LENGTH) return 'tooLong';
  if (/\s/.test(trimmed)) return 'whitespace';
  return null;
}

export interface ConnectionProblems {
  readonly name?: ConnectionNameProblem;
  readonly baseUrl?: BaseUrlProblem;
  readonly apiKey?: ApiKeyProblem;
}

/** Все проблемы формы разом: пустой объект — можно сохранять. */
export function connectionInputProblems(input: {
  name: string;
  baseUrl: string;
  apiKey?: string;
}): ConnectionProblems {
  const name = connectionNameProblem(input.name);
  const baseUrl = baseUrlProblem(input.baseUrl);
  const apiKey = input.apiKey === undefined ? null : apiKeyProblem(input.apiKey);
  return {
    ...(name ? { name } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
}

export function hasProblems(problems: ConnectionProblems): boolean {
  return Object.keys(problems).length > 0;
}

/**
 * Адрес в том виде, в каком его хранят: без пробелов по краям и без завершающих `/` — к нему
 * дописывают `/models`, и двойная косая черта ломает часть серверов.
 */
export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

/** Адрес списка моделей OpenAI-совместимого сервера. */
export function modelsEndpoint(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/models`;
}

/** Короче этого ключ не подписываем даже частично: четыре символа выдали бы его заметную долю. */
const KEY_HINT_MIN_LENGTH = 12;
const KEY_HINT_LENGTH = 4;

/**
 * Что показать о ключе в браузере: последние четыре символа, как делают облачные консоли. У
 * короткого ключа — ничего, только признак, что ключ задан.
 */
export function keyHint(key: string | null): string | null {
  if (key === null) return null;
  const trimmed = key.trim();
  if (trimmed.length < KEY_HINT_MIN_LENGTH) return null;
  return trimmed.slice(-KEY_HINT_LENGTH);
}

export type ConnectionLocation = 'local' | 'cloud';

/**
 * Где сервер относительно сервера приложения: на той же машине или в своей сети — `local`,
 * иначе `cloud`. Решается по адресу: localhost, петля (127.0.0.0/8, ::1), имена `.local` и
 * `.localhost`, а также частные сети (10/8, 172.16/12, 192.168/16) — видеокарта в соседней
 * комнате для человека тоже «локально», а не облако.
 */
export function connectionLocation(baseUrl: string): ConnectionLocation {
  let host: string;
  try {
    host = new URL(baseUrl.trim()).hostname.toLowerCase();
  } catch {
    return 'cloud';
  }
  host = host.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return 'local';
  }
  if (host === '::1' || host === '0.0.0.0') return 'local';
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (ipv4) {
    const first = Number(ipv4[1]);
    const second = Number(ipv4[2]);
    if (first === 127 || first === 10) return 'local';
    if (first === 192 && second === 168) return 'local';
    if (first === 172 && second >= 16 && second <= 31) return 'local';
  }
  return 'cloud';
}

/**
 * Имя, которое форма предлагает сама: у пресета — название рантайма, у своего сервера — имя хоста
 * из адреса.
 */
export function suggestedConnectionName(preset: ConnectionPreset, baseUrl: string): string {
  if (preset !== 'custom') return PRESET_NAMES[preset];
  try {
    return new URL(baseUrl.trim()).hostname.slice(0, CONNECTION_NAME_MAX_LENGTH);
  } catch {
    return '';
  }
}

/** Назначение роли; если его почему-то нет в списке — «не назначена». */
export function assignmentFor(settings: ModelSettings, role: PipelineRole): RoleAssignment {
  return settings.roles.find((item) => item.role === role) ?? { role, kind: 'unassigned' };
}

/** Обязательные роли без модели: пока они есть, колоду собрать нечем. */
export function unassignedRequiredRoles(settings: ModelSettings): readonly PipelineRole[] {
  return PIPELINE_ROLES.filter(
    (role) => !isRoleOptional(role) && assignmentFor(settings, role).kind === 'unassigned',
  );
}

/** Роли, назначенные на подключение: они станут не назначены, если его удалить. */
export function rolesUsingConnection(
  settings: ModelSettings,
  connectionId: string,
): readonly PipelineRole[] {
  return settings.roles
    .filter((item) => item.kind === 'model' && item.connectionId === connectionId)
    .map((item) => item.role);
}

/** Модели из последней успешной проверки; не проверяли или не вышло — пусто. */
export function knownModels(connection: ModelConnection): readonly string[] {
  return connection.lastCheck?.ok === true ? connection.lastCheck.models : [];
}

/** Нет такого подключения: его удалили в другой вкладке или id неверный. */
export class ConnectionNotFoundError extends Error {
  override readonly name = 'ConnectionNotFoundError';
  readonly connectionId: string;

  constructor(connectionId: string) {
    super(`Model connection not found: ${connectionId}`);
    this.connectionId = connectionId;
  }
}

/** Ввод не прошёл проверку. `problems` — по полям формы, если дело в них. */
export class InvalidModelSettingsError extends Error {
  override readonly name = 'InvalidModelSettingsError';
  readonly problems: ConnectionProblems;

  constructor(problems: ConnectionProblems = {}) {
    super('Invalid model settings');
    this.problems = problems;
  }
}

/**
 * Хранилище настроек моделей. Сейчас — демо в памяти сервера (`mocks/demo-model-settings.ts`);
 * API встанет на это место, не трогая интерфейса.
 *
 * Ключ принимает только `saveConnection` и отдаёт только сервер — моделям. Наружу из методов он
 * не выходит ни в каком виде, кроме `keyHint`.
 */
export interface ModelSettingsSource {
  get(): Promise<ModelSettings>;
  /**
   * Создать подключение или поправить существующее. Смена адреса или ключа сбрасывает прошлую
   * проверку, если с вводом не пришла новая. Нет подключения — `ConnectionNotFoundError`,
   * ввод с ошибками — `InvalidModelSettingsError`.
   */
  saveConnection(input: ConnectionInput): Promise<ModelConnection>;
  /** Удалить подключение; роли, назначенные на него, становятся не назначены. */
  deleteConnection(connectionId: string): Promise<void>;
  /** Проверить сохранённое подключение и запомнить итог в `lastCheck`. */
  checkConnection(connectionId: string): Promise<ModelConnection>;
  /** Проверить подключение из формы, ничего не сохраняя. */
  probe(input: ProbeInput): Promise<ConnectionCheck>;
  /**
   * Назначить роль. Выключить можно только необязательную роль; модель — только на существующем
   * подключении.
   */
  setRole(assignment: RoleAssignment): Promise<void>;
}
