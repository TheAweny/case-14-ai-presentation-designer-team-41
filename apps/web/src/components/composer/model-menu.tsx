'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  CheckIcon,
  ChevronDownIcon,
  ConnectIcon,
  SearchIcon,
  SettingsIcon,
} from '@/components/ui/icons';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { openSettings } from '@/components/settings/open-settings';
import { useWriterModels } from '@/components/settings/model-settings-store';
import { reasoningControl, type ReasoningEffort } from '@lct/contracts';
import type { ModelRef } from '@/lib/model-settings';
import {
  readReasoningEffort,
  subscribeReasoningEffort,
  writeReasoningEffort,
} from '@/lib/reasoning-effort';
import { EffortSlider } from './effort-slider';
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
import { PROMPT_CHIP } from './prompt-box';

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
  const effort = useSyncExternalStore(subscribeReasoningEffort, readReasoningEffort, () => null);
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
  const control = selected ? reasoningControl(selected.modelId) : 'none';
  const levelLabel = (level: ReasoningEffort) => t(`levels.${level}`);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={compact ? 'default' : 'lg'}
          className={cn(PROMPT_CHIP, compact ? 'max-w-36 px-2.5' : 'max-w-52')}
          aria-label={label ?? (selected ? t('change', { model: selected.modelId }) : t('menu'))}
          title={selected?.modelId}
        >
          <span className="flex min-w-0 items-center gap-1.5">
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
            {control === 'effort' && effort ? (
              <span key={effort} className="effort-label shrink-0 text-muted-foreground">
                {levelLabel(effort)}
              </span>
            ) : null}
          </span>
          <ChevronDownIcon data-icon="inline-end" className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="flex w-80 flex-col overflow-hidden p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {!available ? (
          <p role="status" className="px-3 pt-2 text-xs text-destructive">
            {t('unavailableHint', { model: selected?.modelId ?? '' })}
          </p>
        ) : null}
        <ModelList
          models={models}
          selected={value}
          followingDefault={value === null}
          control={control}
          effort={effort ?? 'high'}
          onEffort={writeReasoningEffort}
          onPick={(model) => {
            onChange(model);
            setOpen(false);
          }}
          onUseDefault={() => {
            onChange(null);
            setOpen(false);
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
  followingDefault,
  control,
  effort,
  onEffort,
  onPick,
  onUseDefault,
  onManage,
}: {
  models: WriterModels;
  /** Явно выбранная модель. Null — человек следует модели по умолчанию. */
  selected: ModelRef | null;
  followingDefault: boolean;
  control: 'effort' | 'thinking' | 'none';
  effort: ReasoningEffort;
  onEffort: (value: ReasoningEffort) => void;
  onPick: (ref: ModelRef) => void;
  onUseDefault: () => void;
  onManage: () => void;
}) {
  const t = useTranslations('composer.model');
  const listId = useId();
  const list = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLSpanElement>(null);
  const rowRefs = useRef<(HTMLElement | null)[]>([]);
  const freshGlow = useRef(true);
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

  useLayoutEffect(() => {
    const mark = glow.current;
    const row = rowRefs.current[active];
    if (!mark) return;
    if (!row || rows[active]?.kind !== 'model') {
      mark.style.opacity = '0';
      return;
    }
    if (freshGlow.current) mark.style.transition = 'none';
    mark.style.transform = `translateY(${row.offsetTop}px)`;
    mark.style.height = `${row.offsetHeight}px`;
    mark.style.opacity = '1';
    if (freshGlow.current) {
      freshGlow.current = false;
      void mark.offsetHeight;
      mark.style.transition = '';
    }
  }, [active, rows]);

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
        <div className="flex flex-wrap gap-1 border-b border-border px-2 py-1.5">
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
        className="relative max-h-80 overflow-y-auto overscroll-contain py-1 outline-none"
      >
        <span ref={glow} aria-hidden className="menu-glow" />
        {models.assigned ? (
          <div
            role="option"
            aria-selected={followingDefault}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onUseDefault}
            className="relative z-1 flex h-9 cursor-default items-center gap-2 rounded-lg px-2 text-[0.8125rem] text-foreground"
          >
            <span className="min-w-0 flex-1 truncate">{t('useDefault')}</span>
            <CheckIcon
              aria-hidden
              className={cn('size-3.5 shrink-0', followingDefault ? 'opacity-100' : 'opacity-0')}
            />
          </div>
        ) : null}
        {rows.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">{t('notFound')}</p>
        ) : (
          rows.map((row, at) =>
            row.kind === 'header' ? (
              <p
                key={row.key}
                role="presentation"
                className="relative z-1 truncate px-2 pt-2.5 pb-1 text-[0.6875rem] text-muted-foreground first:pt-1"
              >
                {row.section === 'pinned' ? t('pinned') : row.name}
              </p>
            ) : (
              <div
                key={row.key}
                id={`${listId}-${at}`}
                ref={(node) => {
                  rowRefs.current[at] = node;
                }}
                data-row={at}
                role="option"
                aria-selected={!followingDefault && sameModel(row.ref, selected)}
                title={row.ref.modelId}
                onPointerEnter={() => {
                  if (active !== at) setActive(at);
                }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(row.ref)}
                className="relative z-1 flex h-9 cursor-default items-center gap-2 rounded-lg px-2 text-[0.8125rem] text-foreground"
              >
                <span className="min-w-0 flex-1 truncate">{shortModelName(row.ref.modelId)}</span>
                <CheckIcon
                  aria-hidden
                  className={cn(
                    'size-3.5 shrink-0',
                    !followingDefault && sameModel(row.ref, selected) ? 'opacity-100' : 'opacity-0',
                  )}
                />
              </div>
            ),
          )
        )}
      </div>
      {control === 'effort' ? (
        <div className="border-t border-border px-1 pt-2.5">
          <div className="flex items-center justify-between px-2 text-[0.8125rem] text-muted-foreground">
            <span>{t('effort')}</span>
            <span key={effort} className="effort-label font-medium text-foreground">
              {t(`levels.${effort}`)}
            </span>
          </div>
          <EffortSlider
            value={effort}
            onChange={onEffort}
            label={t('effortLabel')}
            valueText={(level) => t(`levels.${level}`)}
          />
        </div>
      ) : control === 'thinking' ? (
        <p className="border-t border-border px-3 py-2.5 text-xs text-muted-foreground">
          {t('thinkingOn')}
        </p>
      ) : null}
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
