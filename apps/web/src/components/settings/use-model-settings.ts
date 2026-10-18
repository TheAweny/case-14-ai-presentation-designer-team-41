'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { MODEL_CHECK_TIMEOUT_MS } from '@lct/contracts';
import type { CheckError } from '@/lib/model-settings';
import { useModelSettingsState } from './model-settings-store';

/**
 * Настройки моделей для окна. Своего состояния нет: окно и поля ввода читают один кэш
 * текущего аккаунта. Ответ действия публикуется сразу и не затирается поздней загрузкой.
 */
export function useModelSettings() {
  return useModelSettingsState();
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
