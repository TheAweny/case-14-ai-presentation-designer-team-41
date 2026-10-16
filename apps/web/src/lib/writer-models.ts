import {
  MODEL_FAMILIES,
  assignmentFor,
  knownModels,
  modelFamily,
  modelOffered,
  type ModelFamily,
  type ModelRef,
  type ModelSettings,
  type PipelineRole,
} from './model-settings';

/**
 * Какой моделью писать текст колоды — выбор у поля ввода, как в чатах. Список — модели
 * подключений из настроек, а по умолчанию текст пишет модель, назначенная роли `writer`.
 *
 * Модуль без React: правила списка проверяются тестами.
 */

/** Модели одного подключения, в порядке, в котором их отдал сервер. */
export interface WriterModelGroup {
  readonly connectionId: string;
  readonly name: string;
  readonly models: readonly string[];
}

export interface WriterModels {
  /** Подключения, у которых есть модели. Пустые и непроверенные в списке не нужны. */
  readonly groups: readonly WriterModelGroup[];
  /** Role default (primary model unless overridden); null means no default is configured. */
  readonly assigned: ModelRef | null;
  /** Сколько моделей всего: выбор нужен, только когда их больше одной. */
  readonly count: number;
}

/** Генерацию можно начинать только после загрузки настроек и наличия проверенной модели writer. */
export function writerModelReady(
  models: WriterModels | null,
  picked: ModelRef | null = null,
): models is WriterModels {
  const selected = models ? effectiveModel(models, picked) : null;
  return (
    models !== null &&
    selected !== null &&
    models.groups.some(
      (group) =>
        group.connectionId === selected.connectionId && group.models.includes(selected.modelId),
    )
  );
}

export function sameModel(a: ModelRef | null, b: ModelRef | null): boolean {
  return a !== null && b !== null && a.connectionId === b.connectionId && a.modelId === b.modelId;
}

/**
 * Список для выбора. Модель роли `writer` входит в него, даже если её вписали вручную и
 * проверка подключения её не нашла: это выбор человека в настройках, и он главный.
 */
export function writerModels(settings: ModelSettings, role: PipelineRole = 'writer'): WriterModels {
  const chosen = assignmentFor(settings, role);
  const writer = chosen.kind === 'model' ? chosen : assignmentFor(settings, 'writer');
  const assigned: ModelRef | null =
    writer.kind === 'model' &&
    settings.connections.some((connection) => connection.connectionId === writer.connectionId)
      ? { connectionId: writer.connectionId, modelId: writer.modelId }
      : null;

  const groups = settings.connections
    .map((connection) => {
      const known = knownModels(connection);
      const manual =
        assigned?.connectionId === connection.connectionId &&
        !known.includes(assigned.modelId) &&
        modelOffered(connection, assigned.modelId)
          ? [assigned.modelId]
          : [];
      return {
        connectionId: connection.connectionId,
        name: connection.name,
        models: [...manual, ...known],
      };
    })
    .filter((group) => group.models.length > 0);

  return {
    groups,
    assigned,
    count: groups.reduce((sum, group) => sum + group.models.length, 0),
  };
}

/** Resolve exactly the selected model or the role default. Unavailable choices stay visible. */
export function effectiveModel(models: WriterModels, picked: ModelRef | null): ModelRef | null {
  return picked ?? models.assigned;
}

/**
 * Короткое имя модели для кнопки: без организации и пути (`meta-llama/Llama-3.1-8B` →
 * `Llama-3.1-8B`). Полное имя остаётся в меню.
 */
export function shortModelName(modelId: string): string {
  // Hosted URIs carry a folder and revision, e.g. gpt://folder/qwen3/latest.
  const hosted = /^[a-z][a-z0-9+.-]*:\/\/[^/]+\/([^/]+)(?:\/[^/]+)?$/i.exec(modelId);
  if (hosted?.[1]) return hosted[1];
  const tail = modelId.split('/').filter(Boolean).at(-1);
  return tail ?? modelId;
}

/** С этого числа моделей у меню появляется поиск, а выбранная и модель по умолчанию — сверху. */
export const MODEL_SEARCH_FROM = 9;

/** Семейство, которым сужают список. `all` — без сужения. */
export type ModelFamilyFilter = ModelFamily | 'all';

/** Семейства, которые реально есть в списке, в порядке чипов. */
export function modelFamilies(models: WriterModels): readonly ModelFamily[] {
  return byFamily(models.groups.flatMap((group) => group.models)).map(({ family }) => family);
}

/** Модели одного семейства, в порядке списка. */
export interface FamilyGroup {
  readonly family: ModelFamily;
  readonly models: readonly string[];
}

/** Модели по семействам: семейства — в порядке чипов, модели внутри — в порядке списка. */
export function byFamily(modelIds: readonly string[]): readonly FamilyGroup[] {
  const groups = new Map<ModelFamily, string[]>();
  for (const modelId of modelIds) {
    const family = modelFamily(modelId);
    const group = groups.get(family);
    if (group) group.push(modelId);
    else groups.set(family, [modelId]);
  }
  return MODEL_FAMILIES.flatMap((family) => {
    const models = groups.get(family);
    return models ? [{ family, models }] : [];
  });
}

/** Строка меню моделей: заголовок раздела или модель. */
export type ModelRow =
  | {
      readonly kind: 'header';
      readonly key: string;
      readonly section: 'pinned' | 'connection';
      readonly name: string;
    }
  | {
      readonly kind: 'model';
      readonly key: string;
      readonly ref: ModelRef;
      /** Модель роли `writer`. */
      readonly isDefault: boolean;
      /** Имя подключения — у закреплённых строк, где заголовка сервера над ними нет. */
      readonly connectionName: string | null;
    };

/**
 * Строки меню. В длинном списке без поиска сверху закреплены выбранная модель и модель по
 * умолчанию — их ищут чаще всего. Поиск — по вхождению в id модели или имя сервера, без
 * учёта регистра. Заголовки серверов — когда серверов несколько или над ними есть закреплённые.
 */
export function modelRows(
  models: WriterModels,
  selected: ModelRef | null,
  query: string,
  family: ModelFamilyFilter = 'all',
): readonly ModelRow[] {
  const needle = query.trim().toLowerCase();
  const nameOf = (connectionId: string) =>
    models.groups.find((group) => group.connectionId === connectionId)?.name ?? '';
  const row = (ref: ModelRef, section: string, pinned: boolean): ModelRow => ({
    kind: 'model',
    key: `${section}:${ref.connectionId}:${ref.modelId}`,
    ref,
    isDefault: sameModel(ref, models.assigned),
    connectionName: pinned ? nameOf(ref.connectionId) : null,
  });

  const rows: ModelRow[] = [];
  const pinned = needle === '' && models.count >= MODEL_SEARCH_FROM;
  if (pinned) {
    const top = [selected, models.assigned].filter(
      (ref, at, all): ref is ModelRef =>
        ref !== null &&
        models.groups.some(
          (group) => group.connectionId === ref.connectionId && group.models.includes(ref.modelId),
        ) &&
        (family === 'all' || modelFamily(ref.modelId) === family) &&
        all.findIndex((other) => sameModel(other, ref)) === at,
    );
    if (top.length > 0) {
      rows.push({ kind: 'header', key: 'pinned', section: 'pinned', name: '' });
      for (const ref of top) rows.push(row(ref, 'pinned', true));
    }
  }

  const headed = models.groups.length > 1 || rows.length > 0;
  for (const group of models.groups) {
    const groupMatches = group.name.toLowerCase().includes(needle);
    const matching = group.models.filter(
      (modelId) =>
        (family === 'all' || modelFamily(modelId) === family) &&
        (groupMatches || modelId.toLowerCase().includes(needle)),
    );
    if (matching.length === 0) continue;
    if (headed) {
      rows.push({
        kind: 'header',
        key: `connection:${group.connectionId}`,
        section: 'connection',
        name: group.name,
      });
    }
    for (const modelId of matching) {
      rows.push(row({ connectionId: group.connectionId, modelId }, group.connectionId, false));
    }
  }
  return rows;
}
