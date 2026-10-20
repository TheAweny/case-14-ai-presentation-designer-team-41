import { modelFailureSchema, type JobErrorCode } from '@lct/contracts';
import { ModelRequestError } from '../chat/model-failure.js';
import { EngineHttpError } from '@lct/engine-client';
import { ModelAnswerValidationError } from './provider.js';

/** Public failure is separate from the technical diagnostic saved beside the run. */
export function generationFailure(
  error: unknown,
  signal: AbortSignal,
): { code: JobErrorCode; message: string; retryable: boolean } {
  // The engine answered with an error: that is the cause, even when the deadline passed while
  // the request was out. Calling it a timeout would send the person to wait instead of to the engine.
  if (error instanceof EngineHttpError) return engineFailure(error);
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
  const serialized = error as { failure?: unknown; cause?: { failure?: unknown } } | null;
  const modelFailure = modelFailureSchema.safeParse(
    error instanceof ModelRequestError
      ? error.failure
      : (serialized?.failure ?? serialized?.cause?.failure),
  );
  if (modelFailure.success) {
    const failures: Partial<
      Record<
        typeof modelFailure.data.kind,
        { code: JobErrorCode; message: string; retryable: boolean }
      >
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
      unsupported: {
        code: 'invalid-response',
        message: 'Провайдер отклонил параметры запроса. Проверьте совместимость подключения.',
        retryable: false,
      },
    };
    return (
      failures[modelFailure.data.kind] ?? {
        code: 'model-unavailable',
        message: 'Модель временно недоступна. Сохранённые задачи не потеряны.',
        retryable: true,
      }
    );
  }
  const named = error as { name?: string; code?: string; requiresReview?: boolean } | null;
  if (named?.code === 'account-limit')
    return {
      code: 'account-limit',
      message: 'Достигнут лимит, установленный администратором. Готовые результаты доступны.',
      retryable: false,
    };
  if (named?.code === 'account-disabled')
    return {
      code: 'account-disabled',
      message: 'Аккаунт отключён. Готовые результаты сохранены.',
      retryable: false,
    };
  if (named?.code === 'usage-budget-exceeded')
    return {
      code: 'usage-budget-exceeded',
      message:
        'Исчерпан согласованный лимит запросов или токенов. Сохранённые результаты доступны; продолжение сохраняет накопленный расход.',
      retryable: false,
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

function engineFailure(error: EngineHttpError) {
  return {
    code: (error.path.includes('export') || error.path.includes('composition-decks')
      ? 'export-failed'
      : 'engine-failed') as JobErrorCode,
    message:
      'Движок не завершил сборку файла. Продолжите с сохранённых задач после проверки движка.',
    retryable: true,
  };
}

/**
 * A model call that failed on the provider's side (an HTTP error after its retries, a timeout,
 * a dropped connection, an answer still unusable after repair). The round it was for is skipped
 * and the variant goes on; a failure of our own state is not one of these and stays fatal.
 */
export function degradable(error: unknown): boolean {
  if (error instanceof ModelRequestError || error instanceof ModelAnswerValidationError)
    return true;
  if (error instanceof TypeError) return true;
  if (!(error instanceof Error)) return false;
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return true;
  return /^(Model returned empty or truncated JSON|Semantic attempt limit|Model API HTTP)/.test(
    error.message,
  );
}
