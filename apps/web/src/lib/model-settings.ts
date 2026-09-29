import {
  CONNECTION_NAME_MAX_LENGTH,
  PIPELINE_ROLES,
  enabledModelIds,
  isModelEnabled,
  isRoleOptional,
  type ConnectionModelsInput,
  type ConnectionCheck,
  type ConnectionInput,
  type ConnectionPreset,
  type ConnectionProblems,
  type ModelConnection,
  type ModelSettings,
  type PipelineRole,
  type ProbeInput,
  type RoleAssignment,
} from '@lct/contracts';

/**
 * Настройки моделей: подключения к OpenAI-совместимым серверам и то, какая модель выполняет
 * каждую роль пайплайна. Где будут работать модели — на локальной видеокарте, в облаке или на
 * нескольких серверах сразу, — заранее неизвестно, поэтому продукт даёт подключить любой такой
 * сервер и назначить его модели ролям.
 *
 * Все обращения к моделям идут с сервера приложения, поэтому и настройки живут там: браузер
 * видит только, задан ли ключ, и его последние символы (`hasKey`, `keyHint`), но не сам ключ.
 *
 * Схемы и проверки ввода — общий контракт с API (`packages/contracts/src/model-settings.ts`):
 * API по ним хранит настройки, интерфейс по ним же проверяет форму. Здесь они переэкспортированы
 * под прежними именами, а рядом — то, что нужно только интерфейсу.
 *
 * Модуль без React и DOM: правила ввода и классификация адресов проверяются тестами.
 */

export {
  API_KEY_MAX_LENGTH,
  BASE_URL_MAX_LENGTH,
  CONNECTION_NAME_MAX_LENGTH,
  CONNECTION_PRESETS,
  MODEL_ID_MAX_LENGTH,
  MODEL_LIST_MAX_LENGTH,
  PIPELINE_ROLES,
  SERVER_CONNECTION_ID,
  apiKeyProblem,
  baseUrlProblem,
  checkErrorSchema as CheckErrorSchema,
  connectionModelsInputSchema as ConnectionModelsInputSchema,
  connectionCheckSchema as ConnectionCheckSchema,
  connectionInputProblems,
  connectionInputSchema as ConnectionInputSchema,
  connectionNameProblem,
  connectionPresetSchema as ConnectionPresetSchema,
  enabledModelIds,
  hasProblems,
  isModelEnabled,
  isRoleOptional,
  keyHint,
  modelConnectionSchema as ModelConnectionSchema,
  modelFamily,
  MODEL_FAMILIES,
  modelsEndpoint,
  modelSettingsSchema as ModelSettingsSchema,
  normalizeBaseUrl,
  pipelineRoleSchema as PipelineRoleSchema,
  probeInputSchema as ProbeInputSchema,
  roleAssignmentSchema as RoleAssignmentSchema,
  type ApiKeyProblem,
  type BaseUrlProblem,
  type CheckError,
  type ConnectionModelsInput,
  type ConnectionCheck,
  type ConnectionInput,
  type ConnectionNameProblem,
  type ConnectionPreset,
  type ConnectionProblems,
  type ModelFamily,
  type ModelConnection,
  type ModelRef,
  type ModelSettings,
  type PipelineRole,
  type ProbeInput,
  type RoleAssignment,
} from '@lct/contracts';

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
  const reported = connection.lastCheck?.ok === true ? connection.lastCheck.models : [];
  return enabledModelIds(reported, connection.enabledModels ?? null);
}

/** Модели, которые проверка нашла, ещё до фильтра включённых. */
export function reportedModels(connection: ModelConnection): readonly string[] {
  return connection.lastCheck?.ok === true ? connection.lastCheck.models : [];
}

/**
 * Модель можно выбрать. У подключения без ограничения — любую, и вписанную вручную тоже. У
 * ограниченного — только включённую: иначе вписанный вручную id обходил бы запрет на общем ключе.
 */
export function modelOffered(connection: ModelConnection, modelId: string): boolean {
  return isModelEnabled(modelId, connection.enabledModels ?? null);
}

/** У подключения выключена хотя бы часть моделей. */
export function modelsLimited(connection: ModelConnection): boolean {
  return connection.enabledModels !== null && connection.enabledModels !== undefined;
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
 * Ключи нельзя сохранить: на сервере не задан `MODEL_KEYS_SECRET`, которым они шифруются. Ключ
 * тогда не сохраняется вовсе, а не ложится в базу открытым текстом.
 */
export class ModelKeysUnavailableError extends Error {
  override readonly name = 'ModelKeysUnavailableError';

  constructor() {
    super('Model keys cannot be stored: MODEL_KEYS_SECRET is not set on the server');
  }
}

/**
 * Хранилище настроек моделей. Настройки хранит API (`lib/api-model-settings.ts`): ключи там
 * зашифрованы, а подключение из `.env` сервера видно как встроенное, только для чтения.
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
  /**
   * Ограничить модели подключения. `null` — доступны все, которые нашла проверка. Чужое общее
   * подключение менять нельзя.
   */
  setConnectionModels(input: ConnectionModelsInput): Promise<ModelConnection>;
}
