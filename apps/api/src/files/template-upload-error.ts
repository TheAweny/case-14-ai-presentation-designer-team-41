import type { HttpException } from '@nestjs/common';
import {
  GatewayTimeoutException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EngineHttpError } from '@lct/engine-client';

/** I expose actionable upload failures without forwarding internal paths or tracebacks. */
export function templateUploadError(error: unknown): HttpException {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return new GatewayTimeoutException(
      'Разбор шаблона занял слишком много времени. Попробуйте загрузить его ещё раз.',
    );
  }
  if (error instanceof EngineHttpError && error.status === 422) {
    return new UnprocessableEntityException(
      'Не удалось прочитать содержимое шаблона. Проверьте, что файл открывается в PowerPoint.',
    );
  }
  return new ServiceUnavailableException(
    'Сервис разбора шаблонов временно недоступен. Попробуйте загрузить файл ещё раз.',
  );
}
