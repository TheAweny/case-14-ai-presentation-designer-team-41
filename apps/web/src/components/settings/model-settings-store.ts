'use client';

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { getModelSettingsAction } from '@/app/settings-actions';
import { useAccount } from '@/components/auth/account-context';
import type { ModelSettings, PipelineRole } from '@/lib/model-settings';
import { writerModels, type WriterModels } from '@/lib/writer-models';
import {
  createModelSettingsCache,
  EMPTY_MODEL_SETTINGS,
  type ModelSettingsView,
} from './model-settings-cache';

/**
 * Последние известные настройки моделей во вкладке, отдельно на каждый аккаунт.
 * Окно настроек и поля ввода читают один кэш. Запрос идёт действием уже вошедшего
 * пользователя. userId выбирает слот и сразу уходит в действие: там он сверяется
 * с сессией, и настройки чужого аккаунта не возвращаются.
 */
const cache = createModelSettingsCache((userId) => getModelSettingsAction(userId));

export function subscribeModelSettings(listener: () => void): () => void {
  return cache.subscribe(listener);
}

export function readModelSettings(userId: string | null): ModelSettingsView {
  return cache.read(userId);
}

export function loadModelSettings(userId: string | null): Promise<void> {
  return cache.load(userId);
}

/** Ответ окна настроек. Второй аргумент — аккаунт, которому принадлежит снимок. */
export function publishModelSettings(settings: ModelSettings, userId: string | null): void {
  cache.publish(userId, settings);
}

/**
 * Настройки и ошибка загрузки текущего аккаунта. Снимок прошлого аккаунта не читается:
 * после выхода и смены аккаунта вид пустой, пока не придёт ответ этого аккаунта.
 */
export function useModelSettingsState(): {
  settings: ModelSettings | null;
  failed: boolean;
  reload: () => void;
  setSettings: (settings: ModelSettings) => void;
} {
  const userId = useAccount()?.userId ?? null;
  const view = useSyncExternalStore(
    subscribeModelSettings,
    () => readModelSettings(userId),
    () => EMPTY_MODEL_SETTINGS,
  );

  useEffect(() => {
    void loadModelSettings(userId);
  }, [userId]);

  const reload = useCallback(() => {
    void loadModelSettings(userId);
  }, [userId]);

  const setSettings = useCallback(
    (settings: ModelSettings) => {
      publishModelSettings(settings, userId);
    },
    [userId],
  );

  return { settings: view.settings, failed: view.failed, reload, setSettings };
}

/**
 * Модели, которыми можно писать текст; null — настройки ещё не пришли. Каждое новое поле
 * перечитывает настройки: их могли поменять в другой вкладке.
 */
export function useModelSettingsSnapshot(): ModelSettings | null {
  return useModelSettingsState().settings;
}

export function useWriterModels(role: PipelineRole = 'writer'): WriterModels | null {
  const settings = useModelSettingsSnapshot();
  return useMemo(() => (settings ? writerModels(settings, role) : null), [settings, role]);
}
