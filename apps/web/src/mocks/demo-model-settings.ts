import { checkModelConnection, type CheckOptions } from '../lib/model-connection-check';
import {
  ConnectionInputSchema,
  ConnectionNotFoundError,
  InvalidModelSettingsError,
  PIPELINE_ROLES,
  ProbeInputSchema,
  RoleAssignmentSchema,
  baseUrlProblem,
  connectionInputProblems,
  hasProblems,
  isRoleOptional,
  keyHint,
  normalizeBaseUrl,
  type ConnectionCheck,
  type ConnectionInput,
  type ModelConnection,
  type ModelSettings,
  type ModelSettingsSource,
  type PipelineRole,
  type ProbeInput,
  type RoleAssignment,
} from '../lib/model-settings';

/** Подключение, как его хранит сервер: вместе с ключом. Наружу уходит только `publicView`. */
interface StoredConnection {
  readonly connectionId: string;
  readonly name: string;
  readonly preset: ModelConnection['preset'];
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly lastCheck: ConnectionCheck | null;
}

export interface DemoModelSettingsOptions extends CheckOptions {
  /** Id нового подключения; в тестах — предсказуемый. */
  readonly newId?: () => string;
}

function publicView(stored: StoredConnection): ModelConnection {
  return {
    connectionId: stored.connectionId,
    name: stored.name,
    preset: stored.preset,
    baseUrl: stored.baseUrl,
    hasKey: stored.apiKey !== null,
    keyHint: keyHint(stored.apiKey),
    lastCheck: stored.lastCheck,
  };
}

/** Непустой ключ из формы или null: пустое поле — «ключ не вводили». */
function enteredKey(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/**
 * Демо-хранилище настроек моделей: состояние в памяти сервера, пока API нет. Начинается пустым —
 * ни одного подключения, роли не назначены: где работают модели, знает только тот, кто
 * запускает продукт.
 *
 * Проверка подключения настоящая — `fetch` к серверу моделей. Перезапуск сервера приложения
 * настройки сбрасывает; хранить их будет API.
 */
export function createDemoModelSettings(
  options: DemoModelSettingsOptions = {},
): ModelSettingsSource {
  const { newId = () => globalThis.crypto.randomUUID(), ...checkOptions } = options;
  const connections = new Map<string, StoredConnection>();
  const roles = new Map<PipelineRole, RoleAssignment>();

  const find = (connectionId: string): StoredConnection => {
    const stored = connections.get(connectionId);
    if (!stored) throw new ConnectionNotFoundError(connectionId);
    return stored;
  };

  const snapshot = (): ModelSettings => ({
    connections: [...connections.values()].map(publicView),
    roles: PIPELINE_ROLES.map((role) => roles.get(role) ?? { role, kind: 'unassigned' as const }),
  });

  return {
    async get() {
      return snapshot();
    },

    async saveConnection(raw: ConnectionInput) {
      const parsed = ConnectionInputSchema.safeParse(raw);
      if (!parsed.success) throw new InvalidModelSettingsError();
      const input = parsed.data;
      const problems = connectionInputProblems(input);
      if (hasProblems(problems)) throw new InvalidModelSettingsError(problems);

      const baseUrl = normalizeBaseUrl(input.baseUrl);
      const key = enteredKey(input.apiKey);
      const previous = input.connectionId === undefined ? null : find(input.connectionId);
      const apiKey = key ?? previous?.apiKey ?? null;
      // Старая проверка говорит о старых адресе и ключе: после их смены она уже неправда.
      const unchanged =
        previous !== null && previous.baseUrl === baseUrl && previous.apiKey === apiKey;
      const lastCheck = input.lastCheck ?? (unchanged ? previous.lastCheck : null);

      const stored: StoredConnection = {
        connectionId: previous?.connectionId ?? newId(),
        name: input.name.trim(),
        preset: input.preset,
        baseUrl,
        apiKey,
        lastCheck,
      };
      connections.set(stored.connectionId, stored);
      return publicView(stored);
    },

    async deleteConnection(connectionId) {
      find(connectionId);
      connections.delete(connectionId);
      for (const [role, assignment] of roles) {
        if (assignment.kind === 'model' && assignment.connectionId === connectionId) {
          roles.delete(role);
        }
      }
    },

    async checkConnection(connectionId) {
      const stored = find(connectionId);
      const lastCheck = await checkModelConnection(stored, checkOptions);
      // Пока шла проверка, подключение могли удалить или поправить: итог — только к тому же.
      const current = connections.get(connectionId);
      if (!current) throw new ConnectionNotFoundError(connectionId);
      if (current.baseUrl !== stored.baseUrl || current.apiKey !== stored.apiKey) {
        return publicView(current);
      }
      const checked = { ...current, lastCheck };
      connections.set(connectionId, checked);
      return publicView(checked);
    },

    async probe(raw: ProbeInput) {
      const parsed = ProbeInputSchema.safeParse(raw);
      if (!parsed.success) throw new InvalidModelSettingsError();
      const input = parsed.data;
      const problem = baseUrlProblem(input.baseUrl);
      if (problem) throw new InvalidModelSettingsError({ baseUrl: problem });
      const saved = input.connectionId === undefined ? null : find(input.connectionId);
      const apiKey = enteredKey(input.apiKey) ?? saved?.apiKey ?? null;
      return checkModelConnection(
        { baseUrl: normalizeBaseUrl(input.baseUrl), apiKey },
        checkOptions,
      );
    },

    async setRole(raw: RoleAssignment) {
      const parsed = RoleAssignmentSchema.safeParse(raw);
      if (!parsed.success) throw new InvalidModelSettingsError();
      const assignment = parsed.data;
      if (assignment.kind === 'disabled' && !isRoleOptional(assignment.role)) {
        throw new InvalidModelSettingsError();
      }
      if (assignment.kind === 'model') find(assignment.connectionId);
      if (assignment.kind === 'unassigned') roles.delete(assignment.role);
      else roles.set(assignment.role, assignment);
    },
  };
}
