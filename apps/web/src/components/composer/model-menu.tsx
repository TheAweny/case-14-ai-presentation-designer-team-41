'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  CheckIcon,
  ChevronDownIcon,
  ConnectIcon,
  SearchIcon,
  ServerIcon,
  SettingsIcon,
} from '@/components/ui/icons';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { openSettings } from '@/components/settings/open-settings';
import { useWriterModels } from '@/components/settings/model-settings-store';
import type { ModelRef } from '@/lib/model-settings';
import { cn } from '@/lib/utils';
import {
  MODEL_SEARCH_FROM,
  effectiveModel,
  modelRows,
  sameModel,
  shortModelName,
  type ModelRow,
  type WriterModels,
} from '@/lib/writer-models';

/**
 * Какой моделью писать текст. Стоит у кнопки отправки, как в чатах. Список — модели подключений
 * из настроек, сгруппированные по серверу; модель роли `writer` помечена «по умолчанию». У
 * длинного списка (облачный шлюз отдаёт их сотнями) — поиск, а выбранная и модель по умолчанию
 * закреплены сверху.
 *
 * Одна модель — выбирать не из чего, и кнопки нет. Ни одной — вместо выбора тихая ссылка
 * «Подключить модель» в настройки: без модели колоду собрать нечем.
 */
export function ModelMenu({
  value,
  onChange,
  compact = false,
}: {
  /** Выбранная модель; null — по умолчанию. */
  value: ModelRef | null;
  onChange: (model: ModelRef) => void;
  /** Узкое поле панели редактора: кнопка ниже и уже. */
  compact?: boolean;
}) {
  const t = useTranslations('composer.model');
  const models = useWriterModels();
  const [open, setOpen] = useState(false);
  if (!models) return null;

  const trigger = cn(
    'min-w-0 rounded-full font-normal text-muted-foreground',
    compact ? 'max-w-36' : 'max-w-44 pr-2 pl-3',
  );

  if (models.count === 0) {
    return (
      <Button
        type="button"
        variant="ghost"
        size={compact ? 'default' : 'lg'}
        className={trigger}
        onClick={() => openSettings('models')}
      >
        <ConnectIcon data-icon="inline-start" />
        <span className="truncate">{t('connect')}</span>
      </Button>
    );
  }
  if (models.count < 2) return null;

  const selected = effectiveModel(models, value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={compact ? 'default' : 'lg'}
          className={cn(trigger, 'data-[state=open]:bg-muted')}
          aria-label={selected ? t('change', { model: selected.modelId }) : t('menu')}
          title={selected?.modelId}
        >
          <span className="truncate">
            {selected ? shortModelName(selected.modelId) : t('menu')}
          </span>
          <ChevronDownIcon data-icon="inline-end" className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-80 flex-col overflow-hidden p-0"
        // Фокус ставит сам список: в поиск или на список, а не на первую кнопку.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <ModelList
          models={models}
          selected={selected}
          onPick={(ref) => {
            setOpen(false);
            if (!sameModel(ref, selected)) onChange(ref);
          }}
          onManage={() => {
            setOpen(false);
            openSettings('models');
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

const firstModel = (rows: readonly ModelRow[]) => rows.findIndex((row) => row.kind === 'model');

/** Содержимое поповера: живёт, только пока он открыт, — поиск каждый раз с нуля. */
function ModelList({
  models,
  selected,
  onPick,
  onManage,
}: {
  models: WriterModels;
  selected: ModelRef | null;
  onPick: (ref: ModelRef) => void;
  onManage: () => void;
}) {
  const t = useTranslations('composer.model');
  const listId = useId();
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const searchable = models.count >= MODEL_SEARCH_FROM;
  const rows = useMemo(() => modelRows(models, selected, query), [models, selected, query]);
  const [active, setActive] = useState(() => {
    const at = rows.findIndex((row) => row.kind === 'model' && sameModel(row.ref, selected));
    return at >= 0 ? at : firstModel(rows);
  });

  // Активная строка всегда видна: стрелки прокручивают список за собой.
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-row="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // Без поиска клавиатуру держит сам список.
  useEffect(() => {
    if (!searchable) list.current?.focus();
  }, [searchable]);

  const step = (direction: 1 | -1) => {
    for (let at = active + direction; at >= 0 && at < rows.length; at += direction) {
      if (rows[at]?.kind === 'model') {
        setActive(at);
        return;
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      step(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[active];
      if (row?.kind === 'model') onPick(row.ref);
    }
  };

  const activeRow = rows[active];
  const activeId = activeRow?.kind === 'model' ? `${listId}-${active}` : undefined;

  return (
    <>
      {searchable ? (
        <div className="flex items-center gap-2 border-b border-border px-3">
          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <input
            type="text"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-label={t('search')}
            placeholder={t('search')}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              const next = event.currentTarget.value;
              setQuery(next);
              setActive(firstModel(modelRows(models, selected, next)));
            }}
            onKeyDown={onKeyDown}
            className="h-9 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      ) : null}
      <div
        ref={list}
        id={listId}
        role="listbox"
        aria-label={t('menu')}
        aria-activedescendant={searchable ? undefined : activeId}
        tabIndex={searchable ? -1 : 0}
        onKeyDown={searchable ? undefined : onKeyDown}
        className="max-h-80 overflow-y-auto overscroll-contain p-1 outline-none"
      >
        {searchable ? null : (
          <p className="px-2 pt-1 pb-1.5 text-[0.6875rem] text-muted-foreground">{t('menu')}</p>
        )}
        {rows.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">{t('notFound')}</p>
        ) : (
          rows.map((row, at) =>
            row.kind === 'header' ? (
              <p
                key={row.key}
                role="presentation"
                className="flex items-center gap-1.5 px-2 pt-2.5 pb-1 text-[0.6875rem] text-muted-foreground first:pt-1"
              >
                {row.section === 'connection' ? (
                  <ServerIcon className="size-3 shrink-0" aria-hidden />
                ) : null}
                <span className="truncate">
                  {row.section === 'pinned' ? t('pinned') : row.name}
                </span>
              </p>
            ) : (
              <div
                key={row.key}
                id={`${listId}-${at}`}
                data-row={at}
                role="option"
                aria-selected={sameModel(row.ref, selected)}
                title={row.ref.modelId}
                onMouseMove={() => {
                  if (active !== at) setActive(at);
                }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(row.ref)}
                className={cn(
                  'flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-xs text-foreground',
                  at === active && 'bg-accent text-accent-foreground',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{row.ref.modelId}</span>
                {row.connectionName ? (
                  <span className="max-w-24 shrink-0 truncate text-[0.6875rem] text-muted-foreground">
                    {row.connectionName}
                  </span>
                ) : null}
                {row.isDefault ? (
                  <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
                    {t('default')}
                  </span>
                ) : null}
                <CheckIcon
                  aria-hidden
                  className={cn(
                    'size-3.5 shrink-0',
                    sameModel(row.ref, selected) ? 'opacity-100' : 'opacity-0',
                  )}
                />
              </div>
            ),
          )
        )}
      </div>
      <div className="border-t border-border p-1">
        <button
          type="button"
          onClick={onManage}
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
        >
          <SettingsIcon className="size-3.5" aria-hidden />
          {t('manage')}
        </button>
      </div>
    </>
  );
}
