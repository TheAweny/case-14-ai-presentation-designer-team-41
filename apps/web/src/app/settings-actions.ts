'use server';

import {
  ConnectionNotFoundError,
  InvalidModelSettingsError,
  type ConnectionCheck,
  type ConnectionInput,
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
  if (error instanceof InvalidModelSettingsError) {
    return { ok: false, reason: 'invalid', problems: error.problems };
  }
  throw error;
}

export async function getModelSettingsAction(): Promise<ModelSettings> {
  await requireAccount();
  return modelSettingsSource.get();
}

export async function saveConnectionAction(input: ConnectionInput): Promise<SaveConnectionResult> {
  await requireAccount();
  try {
    const connection = await modelSettingsSource.saveConnection(input);
    return { ok: true, connection, settings: await modelSettingsSource.get() };
  } catch (error) {
    return failure(error);
  }
}

/** Удалить подключение. Уже удалённое — не ошибка: человек хотел, чтобы его не было. */
export async function deleteConnectionAction(connectionId: string): Promise<SettingsResult> {
  await requireAccount();
  if (typeof connectionId !== 'string') return { ok: false, reason: 'invalid', problems: {} };
  try {
    await modelSettingsSource.deleteConnection(connectionId);
  } catch (error) {
    if (!(error instanceof ConnectionNotFoundError)) throw error;
  }
  return { ok: true, settings: await modelSettingsSource.get() };
}

/** Проверить сохранённое подключение: итог запоминается и виден на карточке. */
export async function checkConnectionAction(connectionId: string): Promise<SettingsResult> {
  await requireAccount();
  if (typeof connectionId !== 'string') return { ok: false, reason: 'invalid', problems: {} };
  try {
    await modelSettingsSource.checkConnection(connectionId);
    return { ok: true, settings: await modelSettingsSource.get() };
  } catch (error) {
    return failure(error);
  }
}

/** Проверить подключение из формы, ещё не сохраняя. */
export async function probeConnectionAction(input: ProbeInput): Promise<ProbeResult> {
  await requireAccount();
  try {
    return { ok: true, check: await modelSettingsSource.probe(input) };
  } catch (error) {
    return failure(error);
  }
}

export async function setRoleAction(assignment: RoleAssignment): Promise<SettingsResult> {
  await requireAccount();
  try {
    await modelSettingsSource.setRole(assignment);
    return { ok: true, settings: await modelSettingsSource.get() };
  } catch (error) {
    return failure(error);
  }
}
