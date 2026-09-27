'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getModelSettingsAction } from '@/app/settings-actions';
import { CHECK_TIMEOUT_MS } from '@/lib/model-connection-check';
import type { CheckError, ModelSettings } from '@/lib/model-settings';
import { publishModelSettings } from './model-settings-store';

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
          return t('timeout', { seconds: Math.round(CHECK_TIMEOUT_MS / 1000) });
      }
    },
    [t],
  );
}
