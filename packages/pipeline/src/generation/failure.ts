import type { JobErrorCode } from '@lct/contracts';
import { ModelRequestError } from '../chat/model-failure.js';
import { EngineHttpError } from '@lct/engine-client';

/** Public failure is separate from the technical diagnostic saved beside the run. */
export function generationFailure(
  error: unknown,
  signal: AbortSignal,
): { code: JobErrorCode; message: string; retryable: boolean } {
  if (signal.aborted) {
    const reason = signal.reason as { name?: string } | undefined;
    if (reason?.name === 'TimeoutError' || reason?.name === 'BuildDeadlineError')
      return {
        code: 'budget-exceeded',
        message: 'Время сборки истекло. Продолжите с сохранённых результатов.',
        retryable: true,
      };
    if (reason?.name === 'AbortError')
      return {
        code: 'cancelled',
        message: 'Сборка остановлена. Сохранённые результаты доступны для продолжения.',
        retryable: true,
      };
    return {
      code: 'interrupted',
      message: 'Выполнение прервано. Сохранённые задачи можно продолжить.',
      retryable: true,
    };
  }
  if (error instanceof ModelRequestError) {
    const failures: Partial<
      Record<typeof error.failure.kind, { code: JobErrorCode; message: string; retryable: boolean }>
    > = {
      'rate-limit': {
        code: 'provider-rate-limit',
        message: 'Провайдер ограничил частоту запросов. Повторите продолжение позже.',
        retryable: true,
      },
      'quota-exhausted': {
        code: 'provider-quota',
        message: 'Квота провайдера исчерпана. Проверьте лимиты подключения.',
        retryable: false,
      },
      unauthorized: {
        code: 'provider-auth',
        message: 'Провайдер отклонил доступ. Проверьте настройки подключения.',
        retryable: false,
      },
      timeout: {
        code: 'provider-timeout',
        message: 'Провайдер не ответил вовремя. Исход и стоимость попытки могут быть неизвестны.',
        retryable: true,
      },
    };
    return (
      failures[error.failure.kind] ?? {
        code: 'model-unavailable',
        message: 'Модель временно недоступна. Сохранённые задачи не потеряны.',
        retryable: true,
      }
    );
  }
  const named = error as { name?: string; code?: string; requiresReview?: boolean } | null;
  if (error instanceof EngineHttpError)
    return {
      code: error.path.includes('export') ? 'export-failed' : 'engine-failed',
      message:
        'Движок не завершил сборку файла. Продолжите с сохранённых задач после проверки движка.',
      retryable: true,
    };
  if (named?.requiresReview)
    return {
      code: 'quality-blocked',
      message: 'Текст не помещается или не прошёл проверку. Требуется проверка содержания.',
      retryable: false,
    };
  if (named?.name === 'SyntaxError' || named?.name === 'ZodError')
    return {
      code: 'invalid-response',
      message: 'Модель вернула неполный или неверный ответ. Продолжите с сохранённых задач.',
      retryable: true,
    };
  if (named?.name === 'TimeoutError')
    return {
      code: 'provider-timeout',
      message: 'Истекло время ожидания ответа. Стоимость попытки может быть неизвестна.',
      retryable: true,
    };
  if (named?.name === 'TypeError')
    return {
      code: 'unknown-outcome',
      message: 'Связь с провайдером прервалась. Исход и стоимость попытки неизвестны.',
      retryable: true,
    };
  if (['ENOSPC', 'EIO', 'EACCES', 'EROFS'].includes(named?.code ?? ''))
    return {
      code: 'persistence-failed',
      message: 'Не удалось сохранить результат. Проверьте хранилище перед продолжением.',
      retryable: true,
    };
  return {
    code: 'internal',
    message:
      'Не удалось завершить сборку. Сохранённые результаты можно использовать при продолжении.',
    retryable: true,
  };
}
