'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getModelSettingsAction } from '@/app/settings-actions';
import { MODEL_CHECK_TIMEOUT_MS } from '@lct/contracts';
import type { CheckError, ModelSettings } from '@/lib/model-settings';
import { publishModelSettings } from './model-settings-store';

/** How often the window asks for progress while models are being probed. */
const PROBING_POLL_MS = 2500;

/**
 * Настройки моделей для окна: загружаются, когда открыт раздел, и заменяются целиком ответом
 * каждого действия — так окно не расходится с сервером, даже если настройки правили в другой
 * вкладке.
 */
export function useModelSettings() {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [failed, setFailed] = useState(false);

  // Каждый ответ сервера — и в общий стор: выбор модели у полей ввода следует за окном.
  useEffect(() => {
    if (settings) publishModelSettings(settings);
  }, [settings]);

  const load = useCallback(() => {
    setFailed(false);
    getModelSettingsAction().then(setSettings, () => setFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // While the models of a connection are being probed, the window follows the progress and the
  // models appear in their pickers as they are sorted.
  const probing = settings?.connections.some((connection) => connection.probing) ?? false;
  useEffect(() => {
    if (!probing) return;
    const timer = window.setTimeout(() => {
      getModelSettingsAction().then(setSettings, () => undefined);
    }, PROBING_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [probing, settings]);

  return { settings, failed, reload: load, setSettings };
}

/** Причина неудачной проверки короткой фразой — для карточки и для формы. */
export function useCheckErrorText(): (error: CheckError) => string {
  const t = useTranslations('settings.models.errors');
  return useCallback(
    (error: CheckError) => {
      switch (error.kind) {
        case 'unreachable':
          return error.detail === null
            ? t('unreachable')
            : t('unreachableDetail', { detail: error.detail });
        case 'unauthorized':
          return t('unauthorized', { status: error.status });
        case 'http':
          // 404 на /models почти всегда значит, что в адресе нет префикса API.
          return error.status === 404 ? t('notFound') : t('http', { status: error.status });
        case 'invalid-response':
          return t('invalidResponse');
        case 'timeout':
          return t('timeout', { seconds: Math.round(MODEL_CHECK_TIMEOUT_MS / 1000) });
        case 'blocked':
          return t('blocked');
      }
    },
    [t],
  );
}
