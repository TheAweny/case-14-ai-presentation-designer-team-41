'use server';

import {
  ConnectionNotFoundError,
  InvalidModelSettingsError,
  ModelKeysUnavailableError,
  type ConnectionCheck,
  type ConnectionModelsInput,
  type ConnectionInput,
  type ManualKindsInput,
  type ConnectionProblems,
  type ModelConnection,
  type ModelSettings,
  type ProbeInput,
  type RoleAssignment,
} from '@/lib/model-settings';
import { modelSettingsSource } from '@/mocks/sources';
import { requireAccount } from './auth-session';

/**
 * Действия окна настроек. Лежат вне группы `(library)`: окно открывается и в главном меню, и в
 * редакторе. Страниц они не перерисовывают — настройки видны только в самом окне, и каждое
 * действие возвращает их целиком.
 *
 * Как и соседние действия, ошибку отдают значением: в сборке для продакшена Next прячет текст
 * исключений, а окну нужно знать, что именно не вышло. Аргументы — публичная точка входа, их
 * проверяют схемы источника, несмотря на типы.
 */

export type SettingsFailure =
  | { readonly ok: false; readonly reason: 'notFound' }
  | { readonly ok: false; readonly reason: 'keysUnavailable' }
  | { readonly ok: false; readonly reason: 'invalid'; readonly problems: ConnectionProblems };

export type SettingsResult =
  { readonly ok: true; readonly settings: ModelSettings } | SettingsFailure;

export type SaveConnectionResult =
  | {
      readonly ok: true;
      readonly connection: ModelConnection;
      readonly settings: ModelSettings;
    }
  | SettingsFailure;

export type ProbeResult = { readonly ok: true; readonly check: ConnectionCheck } | SettingsFailure;

/** Ошибки источника → значение; всё остальное — настоящая поломка, пусть летит дальше. */
function failure(error: unknown): SettingsFailure {
  if (error instanceof ConnectionNotFoundError) return { ok: false, reason: 'notFound' };
  if (error instanceof ModelKeysUnavailableError) return { ok: false, reason: 'keysUnavailable' };
  if (error instanceof InvalidModelSettingsError) {
    return { ok: false, reason: 'invalid', problems: error.problems };
  }
  throw error;
}

export async function getModelSettingsAction(
  expectedUserId: string | undefined = undefined,
): Promise<ModelSettings> {
  const account = await requireAccount();
  if (expectedUserId !== undefined && account.userId !== expectedUserId) {
    throw new Error('Model settings were requested for a different account.');
  }
  return modelSettingsSource(account.userId).get();
}

export async function saveConnectionAction(input: ConnectionInput): Promise<SaveConnectionResult> {
  const source = modelSettingsSource((await requireAccount()).userId);
  try {
    const connection = await source.saveConnection(input);
    return { ok: true, connection, settings: await source.get() };
  } catch (error) {
    return failure(error);
  }
}

/** Удалить подключение. Уже удалённое — не ошибка: человек хотел, чтобы его не было. */
export async function deleteConnectionAction(connectionId: string): Promise<SettingsResult> {
  const source = modelSettingsSource((await requireAccount()).userId);
  if (typeof connectionId !== 'string') return { ok: false, reason: 'invalid', problems: {} };
  try {
    await source.deleteConnection(connectionId);
  } catch (error) {
    if (!(error instanceof ConnectionNotFoundError)) throw error;
  }
  return { ok: true, settings: await source.get() };
}

/** Проверить сохранённое подключение: итог запоминается и виден на карточке. */
export async function checkConnectionAction(connectionId: string): Promise<SettingsResult> {
  const source = modelSettingsSource((await requireAccount()).userId);
  if (typeof connectionId !== 'string') return { ok: false, reason: 'invalid', problems: {} };
  try {
    await source.checkConnection(connectionId);
    return { ok: true, settings: await source.get() };
  } catch (error) {
    return failure(error);
  }
}

/** Проверить подключение из формы, ещё не сохраняя. */
export async function probeConnectionAction(input: ProbeInput): Promise<ProbeResult> {
  const source = modelSettingsSource((await requireAccount()).userId);
  try {
    return { ok: true, check: await source.probe(input) };
  } catch (error) {
    return failure(error);
  }
}

export async function setRoleAction(assignment: RoleAssignment): Promise<SettingsResult> {
  const source = modelSettingsSource((await requireAccount()).userId);
  try {
    await source.setRole(assignment);
    return { ok: true, settings: await source.get() };
  } catch (error) {
    return failure(error);
  }
}

/** Отметить вручную, что умеет модель; `kinds: null` — как говорит провайдер. */
export async function setModelKindsAction(
  connectionId: string,
  input: ManualKindsInput,
): Promise<SettingsResult> {
  const source = modelSettingsSource((await requireAccount()).userId);
  try {
    await source.setModelKinds(connectionId, input);
    return { ok: true, settings: await source.get() };
  } catch (error) {
    return failure(error);
  }
}

/** Какие модели подключения доступны. `null` снимает ограничение. */
export async function setConnectionModelsAction(
  input: ConnectionModelsInput,
): Promise<SettingsResult> {
  const source = modelSettingsSource((await requireAccount()).userId);
  try {
    await source.setConnectionModels(input);
    return { ok: true, settings: await source.get() };
  } catch (error) {
    return failure(error);
  }
}
