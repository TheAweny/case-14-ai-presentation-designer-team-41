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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { openSettings } from '@/components/settings/open-settings';
import {
  useWriterModels,
  useModelSettingsSnapshot,
} from '@/components/settings/model-settings-store';
import type { ModelRef } from '@/lib/model-settings';
import { cn } from '@/lib/utils';
import {
  MODEL_SEARCH_FROM,
  effectiveModel,
  modelFamilies,
  modelRows,
  sameModel,
  shortModelName,
  type ModelFamilyFilter,
  type ModelRow,
  type WriterModels,
} from '@/lib/writer-models';
import { PROMPT_PILL } from './prompt-box';

/** Role-aware picker shared by composers and error actions. Null always follows the chat default. */
export function ModelMenu({
  value,
  onChange,
  compact = false,
  label,
}: {
  /** Выбранная модель; null — по умолчанию. */
  value: ModelRef | null;
  onChange: (model: ModelRef | null) => void;
  label?: string;
  /** Узкое поле панели редактора: кнопка ниже и уже. */
  compact?: boolean;
}) {
  const t = useTranslations('composer.model');
  const models = useWriterModels('assistant');
  const settings = useModelSettingsSnapshot();
  const [open, setOpen] = useState(false);
  if (!models) return null;

  const trigger = cn(
    'min-w-0 rounded-full font-normal text-muted-foreground',
    compact ? 'max-w-36' : 'max-w-44 pr-2 pl-3',
  );

  const selected = effectiveModel(models, value);
  if (models.count === 0) {
    // В узкой панели подпись не помещается — значок с подсказкой.
    if (compact && !label) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="rounded-full text-muted-foreground"
              aria-label={
                selected ? t('unavailableHint', { model: selected.modelId }) : t('connect')
              }
              onClick={() => openSettings('models')}
            >
              <ConnectIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {selected ? t('unavailableHint', { model: selected.modelId }) : t('connect')}
          </TooltipContent>
        </Tooltip>
      );
    }
    return (
      <Button
        type="button"
        variant="ghost"
        size={compact ? 'default' : 'lg'}
        className={trigger}
        onClick={() => openSettings('models')}
      >
        <ConnectIcon data-icon="inline-start" />
        <span className="truncate">{label ?? (selected ? t('unavailable') : t('connect'))}</span>
      </Button>
    );
  }
  const available =
    selected === null ||
    models.groups.some(
      (group) =>
        group.connectionId === selected.connectionId && group.models.includes(selected.modelId),
    );
  const overrides =
    settings?.roles.filter(
      (item) => ['planner', 'critic'].includes(item.role) && item.kind === 'model',
    ) ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={compact ? 'default' : 'lg'}
          className={cn(PROMPT_PILL, compact ? 'max-w-36 px-2.5' : 'max-w-44')}
          aria-label={label ?? (selected ? t('change', { model: selected.modelId }) : t('menu'))}
          title={selected?.modelId}
        >
          <span className="truncate">
            {label ??
              (!available
                ? t('unavailable')
                : selected
                  ? value === null
                    ? t('defaultModel', { model: shortModelName(selected.modelId) })
                    : shortModelName(selected.modelId)
                  : t('chooseDefault'))}
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
        <div className="grid gap-1 border-b border-border px-3 py-2">
          <p className="text-xs text-muted-foreground">{t('scope')}</p>
          {!available ? (
            <p role="status" className="text-xs text-destructive">
              {t('unavailableHint', { model: selected?.modelId ?? '' })}
            </p>
          ) : null}
          {overrides.length ? (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">{t('separateRoles')}</summary>
              {overrides.map((item) =>
                item.kind === 'model' ? (
                  <p key={item.role} className="mt-1 break-all">
                    {t(item.role === 'planner' ? 'roles.planner' : 'roles.critic')}: {item.modelId}
                  </p>
                ) : null,
              )}
            </details>
          ) : null}
          <button
            type="button"
            className="rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            {t('useDefault')}
            {models.assigned ? ` · ${shortModelName(models.assigned.modelId)}` : ''}
          </button>
        </div>
        <ModelList
          models={models}
          selected={selected}
          onPick={(ref) => {
            setOpen(false);
            onChange(ref);
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
export function ModelList({
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
  const [family, setFamily] = useState<ModelFamilyFilter>('all');
  const families = modelFamilies(models);
  const searchable = models.count >= MODEL_SEARCH_FROM;
  const rows = useMemo(
    () => modelRows(models, selected, query, family),
    [models, selected, query, family],
  );
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
              setActive(firstModel(modelRows(models, selected, next, family)));
            }}
            onKeyDown={onKeyDown}
            className="h-9 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      ) : null}
      {families.length > 1 ? (
        <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
          {(['all', ...families] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={family === option}
              onClick={() => {
                setFamily(option);
                setActive(firstModel(modelRows(models, selected, query, option)));
              }}
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] text-muted-foreground outline-none',
                'hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring',
                family === option && 'bg-accent text-accent-foreground',
              )}
            >
              {option === 'all' ? t('all') : t(`families.${option}`)}
            </button>
          ))}
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
                <span className="min-w-0 flex-1 truncate">{shortModelName(row.ref.modelId)}</span>
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
