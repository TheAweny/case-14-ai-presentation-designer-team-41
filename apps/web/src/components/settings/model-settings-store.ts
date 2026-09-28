'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { getModelSettingsAction } from '@/app/settings-actions';
import type { ModelSettings } from '@/lib/model-settings';
import { writerModels, type WriterModels } from '@/lib/writer-models';

/**
 * Последние известные настройки моделей во вкладке. Их читают поля ввода — чтобы показать выбор
 * модели, — а окно настроек кладёт сюда каждый свой ответ сервера: подключили модель — выбор у
 * поля появился сразу, без перезагрузки.
 */
let current: ModelSettings | null = null;
let loading = false;
const listeners = new Set<() => void>();

export function publishModelSettings(settings: ModelSettings): void {
  current = settings;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function load(): void {
  if (loading) return;
  loading = true;
  getModelSettingsAction()
    .then(publishModelSettings, () => undefined)
    .finally(() => {
      loading = false;
    });
}

/**
 * Модели, которыми можно писать текст; null — настройки ещё не пришли. Каждое новое поле
 * перечитывает настройки: их могли поменять в другой вкладке.
 */
export function useWriterModels(): WriterModels | null {
  const settings = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  useEffect(load, []);
  return useMemo(() => (settings ? writerModels(settings) : null), [settings]);
}
