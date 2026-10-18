/**
 * Кэш настроек моделей на вкладку, общий для окна настроек и полей ввода.
 * Ключ — `userId` аккаунта. Чтение не создаёт записей: смена аккаунта во время
 * рендера только выбирает другой снимок, а загрузка начинается позже, из эффекта.
 *
 * На аккаунт приходится один запрос. Ответ, ушедший до `publish`, не записывается:
 * публикация увеличивает поколение. Чужой и пустой аккаунт этот снимок не отдают.
 */
import type { ModelSettings } from '@/lib/model-settings';

export interface ModelSettingsView {
  readonly settings: ModelSettings | null;
  readonly failed: boolean;
}

export const EMPTY_MODEL_SETTINGS: ModelSettingsView = { settings: null, failed: false };

interface AccountSlot {
  generation: number;
  view: ModelSettingsView;
  flight: { readonly generation: number; readonly promise: Promise<void> } | null;
}

export interface ModelSettingsCache {
  subscribe(listener: () => void): () => void;
  read(userId: string | null): ModelSettingsView;
  load(userId: string | null): Promise<void>;
  publish(userId: string | null, settings: ModelSettings): void;
}

export function createModelSettingsCache(
  fetchSettings: (userId: string) => Promise<ModelSettings>,
): ModelSettingsCache {
  const slots = new Map<string, AccountSlot>();
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const listener of listeners) listener();
  }

  function slot(userId: string): AccountSlot {
    const existing = slots.get(userId);
    if (existing) return existing;
    const created: AccountSlot = { generation: 0, view: EMPTY_MODEL_SETTINGS, flight: null };
    slots.set(userId, created);
    return created;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    read(userId) {
      if (userId === null) return EMPTY_MODEL_SETTINGS;
      return slots.get(userId)?.view ?? EMPTY_MODEL_SETTINGS;
    },

    load(userId) {
      if (userId === null) return Promise.resolve();
      const current = slot(userId);
      const generation = current.generation;
      if (current.flight?.generation === generation) return current.flight.promise;

      if (current.view.failed) {
        current.view = { settings: current.view.settings, failed: false };
        emit();
      }

      // Запрос стартует сразу, с userId этого вызова. Отложенный вызов успел бы
      // уйти уже с cookie следующего аккаунта и записать чужие настройки в этот слот.
      let request: Promise<ModelSettings>;
      try {
        request = fetchSettings(userId);
      } catch (error) {
        request = Promise.reject(error);
      }
      const tracked = request
        .then(
          (settings) => {
            if (current.generation !== generation) return;
            current.view = { settings, failed: false };
            emit();
          },
          () => {
            if (current.generation !== generation) return;
            current.view = { settings: current.view.settings, failed: true };
            emit();
          },
        )
        .finally(() => {
          if (current.flight?.promise === tracked) current.flight = null;
        });
      current.flight = { generation, promise: tracked };
      return tracked;
    },

    publish(userId, settings) {
      if (userId === null) return;
      const current = slot(userId);
      current.generation += 1;
      current.view = { settings, failed: false };
      emit();
    },
  };
}
