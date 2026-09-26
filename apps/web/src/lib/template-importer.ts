import type { JobEvent, JobStage } from '@lct/contracts';
import type { TemplateSummary } from './library-source';

/**
 * Импорт шаблона: движок разбирает .pptx/.potx и извлекает профиль — палитру, шрифты, сетку и
 * макеты. Это отдельная операция, а не этап генерации: профиль извлекается один раз, кешируется
 * в библиотеке, и дальше презентации собираются по нему. Интерфейс знает только
 * `TemplateImporter`: сейчас за ним демо-источник, потом HTTP-клиент API. Ход импорта приходит
 * теми же событиями `JobEvent`, что и ход генерации.
 */
export interface TemplateImporter {
  /**
   * Извлекает ли источник профиль из самого файла. Демо не извлекает — берёт готовый
   * демо-профиль, и интерфейс говорит об этом прямо, до загрузки.
   */
  readonly profilesFiles: boolean;
  /**
   * Разобрать файл и зарегистрировать шаблон в библиотеке. События приходят в `onEvent` по
   * порядку `seq`. Отмена через `signal` отклоняет обещание ошибкой `AbortError`; сбой сообщает
   * событие `failed` (если источник знает причину), а затем отказ.
   *
   * Годность файла (`templateFileProblem`) проверяет вызывающий до импорта: негодный файл
   * прогона не начинает.
   */
  import(
    file: File,
    onEvent: (event: JobEvent) => void,
    signal: AbortSignal,
  ): Promise<TemplateSummary>;
}

/** Этапы импорта по порядку: чтение файла и извлечение профиля. */
export const IMPORT_STAGES = [
  'parsing-template',
  'profiling-template',
] as const satisfies readonly JobStage[];
export type ImportStage = (typeof IMPORT_STAGES)[number];

export function importStages(): readonly JobStage[] {
  return IMPORT_STAGES;
}

/**
 * Этап импорта из тех, что интерфейс знает по имени. О других сервер может сообщить (ход
 * показывает то, что происходит), и интерфейс называет их общими словами.
 */
export function isImportStage(stage: JobStage): stage is ImportStage {
  return (IMPORT_STAGES as readonly JobStage[]).includes(stage);
}
