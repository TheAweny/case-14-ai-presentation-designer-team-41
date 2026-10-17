'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  setConnectionModelsAction,
  setModelKindsAction,
  type SettingsResult,
} from '@/app/settings-actions';
import { Button } from '@/components/ui/button';
import { BackIcon, SearchIcon } from '@/components/ui/icons';
import { Switch } from '@/components/ui/switch';
import {
  modelFamily,
  modelKindsOf,
  reportedModels,
  type ModelConnection,
  type ModelFamily,
} from '@/lib/model-settings';
import { cn } from '@/lib/utils';
import { byFamily } from '@/lib/writer-models';
import { ModelKindMenu } from './model-kind-menu';

type FamilyFilter = ModelFamily | 'all';
type ModelKindList = Parameters<typeof setModelKindsAction>[1]['kinds'];

/**
 * Следующий список включённых моделей: `ids` включают или выключают. Когда включены все найденные,
 * ограничение снимается (`null`): тогда доступны и новые модели сервера, и вписанные вручную.
 * Включённые модели, которых последняя проверка не нашла, остаются в списке: сервер мог их
 * временно не отдать.
 */
function nextEnabled(
  reported: readonly string[],
  enabled: readonly string[] | null,
  ids: readonly string[],
  on: boolean,
): string[] | null {
  const kept = new Set(enabled ?? reported);
  for (const id of ids) {
    if (on) kept.add(id);
    else kept.delete(id);
  }
  if (reported.every((id) => kept.has(id))) return null;
  return [
    ...reported.filter((id) => kept.has(id)),
    ...[...kept].filter((id) => !reported.includes(id)),
  ];
}

/**
 * Какие модели подключения доступны в выборе. Пока список не ограничен, включены все найденные.
 * Выключение — свойство подключения: у общего подключения и подключения из .env оно действует для
 * всех, кто им пользуется, а менять его может только администратор. Кнопки «Включить все» и
 * «Выключить все» действуют на то, что показано: после фильтра по семейству или поиска — только
 * на найденное.
 */
export function ConnectionModels({
  connection,
  canEditManaged = false,
  onBack,
  apply,
}: {
  connection: ModelConnection;
  /** Текущий аккаунт — администратор: ему можно менять список моделей подключения из .env. */
  canEditManaged?: boolean;
  onBack: () => void;
  apply: (run: () => Promise<SettingsResult>) => Promise<void>;
}) {
  const t = useTranslations('settings.models.connections.models');
  const tFamilies = useTranslations('composer.model');
  const reported = reportedModels(connection);
  // Подключение из .env правит администратор — так же, как общее. Остальным список только показывают.
  const editable = connection.managed ? canEditManaged : connection.editable !== false;
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState<FamilyFilter>('all');
  const [pending, setPending] = useState(false);

  const enabled = connection.enabledModels ?? null;
  const on = (modelId: string) => enabled === null || enabled.includes(modelId);
  const families = byFamily(reported);
  const needle = query.trim().toLowerCase();
  const filtered = family !== 'all' || needle !== '';
  const visible = useMemo(
    () =>
      reported.filter(
        (modelId) =>
          (family === 'all' || modelFamily(modelId) === family) &&
          (needle === '' || modelId.toLowerCase().includes(needle)),
      ),
    [reported, family, needle],
  );
  const enabledCount = reported.filter(on).length;

  const setKinds = (modelId: string, kinds: ModelKindList | null) => {
    if (!editable || pending) return;
    setPending(true);
    void apply(() => setModelKindsAction(connection.connectionId, { modelId, kinds })).finally(() =>
      setPending(false),
    );
  };

  const change = (ids: readonly string[], next: boolean) => {
    if (!editable || pending || ids.length === 0) return;
    setPending(true);
    void apply(() =>
      setConnectionModelsAction({
        connectionId: connection.connectionId,
        enabledModels: nextEnabled(reported, enabled, ids, next),
      }),
    ).finally(() => setPending(false));
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-start gap-2">
        <Button
          type="button"
          variant="ghost"
          className="-ml-2 text-muted-foreground"
          onClick={onBack}
        >
          <BackIcon data-icon="inline-start" />
          {t('back')}
        </Button>
        <div className="grid gap-1 md:pr-8">
          <h2 className="text-base font-semibold">{connection.name}</h2>
          <p className="max-w-xl text-xs text-pretty text-muted-foreground">
            {editable ? t('hint') : t('readOnly')}
          </p>
        </div>
      </div>

      {reported.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
          {t('unchecked')}
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2 rounded-md px-2.5 ring-1 ring-border">
            <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder={t('search')}
              aria-label={t('search')}
              autoComplete="off"
              spellCheck={false}
              className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          {families.length > 1 ? (
            <div className="flex gap-1 overflow-x-auto">
              {(['all', ...families.map((group) => group.family)] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={family === option}
                  onClick={() => setFamily(option)}
                  className={cn(
                    'shrink-0 rounded-full px-2.5 py-1 text-xs text-muted-foreground outline-none',
                    'hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring',
                    family === option && 'bg-accent text-accent-foreground',
                  )}
                >
                  {option === 'all' ? tFamilies('all') : tFamilies(`families.${option}`)}
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p role="status" className="mr-auto text-xs text-muted-foreground">
              {enabled === null
                ? t('summaryAll', { count: reported.length })
                : t('summary', { enabled: enabledCount, count: reported.length })}
            </p>
            {editable ? (
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending || visible.every(on)}
                  onClick={() => change(visible, true)}
                >
                  {filtered ? t('enableShown') : t('enableAll')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending || !visible.some(on)}
                  onClick={() => change(visible, false)}
                >
                  {filtered ? t('disableShown') : t('disableAll')}
                </Button>
              </div>
            ) : null}
          </div>
          {visible.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-lg ring-1 ring-border">
              {visible.map((modelId) => {
                const labelId = `model-${connection.connectionId}-${modelId}`;
                return (
                  <li key={modelId} className="flex items-center gap-3 px-3 py-2.5">
                    <span
                      id={labelId}
                      className={cn(
                        'min-w-0 flex-1 truncate font-mono text-xs',
                        !on(modelId) && 'text-muted-foreground',
                      )}
                    >
                      {modelId}
                    </span>
                    <ModelKindMenu
                      modelId={modelId}
                      {...modelKindsOf(connection, modelId)}
                      editable={editable}
                      disabled={pending}
                      onChange={(kinds) => setKinds(modelId, kinds)}
                    />
                    <Switch
                      aria-labelledby={labelId}
                      checked={on(modelId)}
                      disabled={!editable || pending}
                      onCheckedChange={(checked) => change([modelId], checked)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
