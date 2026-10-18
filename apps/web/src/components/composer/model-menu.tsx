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
import type { ReasoningEffort } from '@lct/contracts';
import type { ModelRef } from '@/lib/model-settings';
import {
  readReasoningEffort,
  subscribeReasoningEffort,
  writeReasoningEffort,
} from '@/lib/reasoning-effort';
import { EffortSlider } from './effort-slider';
import { useModelCapabilities } from './use-model-capabilities';
import { cn } from '@/lib/utils';
import {
  MANUFACTURER_LABEL,
  MANUFACTURERS,
  modelManufacturer,
  type ManufacturerId,
} from '@/lib/model-manufacturers';
import {
  MODEL_SEARCH_FROM,
  effectiveModel,
  modelRows,
  sameModel,
  shortModelName,
  type ModelRow,
  type WriterModels,
} from '@/lib/writer-models';
import { PROMPT_CHIP } from './prompt-box';
import styles from './model-menu.module.css';

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
  const capabilities = useModelCapabilities(models ? effectiveModel(models, value) : null);
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
  const reasoning = capabilities?.reasoning;
  // A depth only where probing showed it changes how much the model thinks. The chat always
  // thinks where it can, so the depth matters even while deck builds do not think.
  const depth = reasoning !== undefined && reasoning.levels;
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
            {depth && effort ? (
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
        className="flex w-[min(22rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-0"
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
          depth={depth}
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

/** Производители, которые реально есть в списке, в порядке колонки. */
function manufacturersOf(rows: readonly ModelRow[]): ManufacturerId[] {
  const present = new Set<ManufacturerId>();
  for (const row of rows) {
    if (row.kind === 'model') present.add(modelManufacturer(row.ref.modelId));
  }
  const named = MANUFACTURERS.filter((id) => present.has(id));
  return present.has('other') ? [...named, 'other'] : named;
}

function visibleRows(
  models: WriterModels,
  selected: ModelRef | null,
  query: string,
  maker: ManufacturerId | 'all',
  grouped: boolean,
): readonly ModelRow[] {
  const all = modelRows(models, selected, query, 'all');
  if (!grouped) return all;
  const kept: ModelRow[] = [];
  let header: ModelRow | null = null;
  let pinned = false;
  for (const row of all) {
    if (row.kind === 'header') {
      pinned = row.section === 'pinned';
      header = pinned ? null : row;
      continue;
    }
    if (
      pinned ||
      (query.trim() === '' && maker !== 'all' && modelManufacturer(row.ref.modelId) !== maker)
    ) {
      continue;
    }
    if (header) {
      kept.push(header);
      header = null;
    }
    kept.push(row);
  }
  return kept;
}

function placeGlow(mark: HTMLElement | null, row: HTMLElement | null, snap: boolean) {
  if (!mark) return;
  if (!row) {
    mark.style.opacity = '0';
    return;
  }
  if (snap) mark.style.transition = 'none';
  const top = row.offsetTop;
  const height = row.offsetHeight;
  mark.style.transform = `translateY(${top}px) scaleY(${height / 32})`;
  mark.style.transformOrigin = 'top';
  mark.style.opacity = '1';
  if (snap) {
    void mark.offsetHeight;
    mark.style.transition = '';
  }
}

/** Содержимое поповера: живёт, только пока он открыт, — поиск каждый раз с нуля. */
export function ModelList({
  models,
  selected,
  followingDefault,
  depth,
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
  /** Show the depth slider: the model takes a depth now. */
  depth: boolean;
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
  const makerGlow = useRef<HTMLSpanElement>(null);
  const rowRefs = useRef<(HTMLElement | null)[]>([]);
  const defaultRef = useRef<HTMLDivElement>(null);
  const makerRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const freshGlow = useRef(true);
  const activeRef = useRef(0);
  const rowsRef = useRef<readonly ModelRow[]>([]);
  const [query, setQuery] = useState('');
  const catalog = useMemo(() => modelRows(models, selected, '', 'all'), [models, selected]);
  const makers = useMemo(() => manufacturersOf(catalog), [catalog]);
  const grouped = makers.some((id) => id !== 'other');
  const initialMaker = (): ManufacturerId | 'all' => {
    if (!grouped) return 'all';
    const current = selected ?? models.assigned;
    if (!current) return 'all';
    const maker = modelManufacturer(current.modelId);
    return makers.includes(maker) ? maker : 'all';
  };
  const [maker, setMaker] = useState<ManufacturerId | 'all'>(initialMaker);
  const searchable = models.count >= MODEL_SEARCH_FROM;
  const searching = query.trim() !== '';
  const rows = useMemo(
    () => visibleRows(models, selected, query, maker, grouped),
    [models, selected, query, maker, grouped],
  );
  const [active, setActive] = useState(() => {
    const at = rows.findIndex((row) => row.kind === 'model' && sameModel(row.ref, selected));
    return at >= 0 ? at : firstModel(rows);
  });
  activeRef.current = active;
  rowsRef.current = rows;

  // Активная строка всегда видна: стрелки прокручивают список за собой.
  useEffect(() => {
    const row =
      active < 0
        ? defaultRef.current
        : list.current?.querySelector<HTMLElement>(`[data-row="${active}"]`);
    row?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, rows]);

  const activeRowEl = () =>
    (active < 0
      ? defaultRef.current
      : rows[active]?.kind === 'model'
        ? rowRefs.current[active]
        : null) ?? null;

  useLayoutEffect(() => {
    placeGlow(glow.current, activeRowEl(), freshGlow.current);
    freshGlow.current = false;
  }, [active, rows, models.assigned]);

  useLayoutEffect(() => {
    const box = list.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    let initialResize = true;
    const observer = new ResizeObserver(() => {
      if (initialResize) {
        initialResize = false;
        return;
      }
      const at = activeRef.current;
      const current = rowsRef.current;
      const row =
        at < 0
          ? defaultRef.current
          : current[at]?.kind === 'model'
            ? (rowRefs.current[at] ?? null)
            : null;
      placeGlow(glow.current, row, true);
    });
    observer.observe(box);
    const row = activeRowEl();
    if (row) observer.observe(row);
    return () => observer.disconnect();
  }, [active, rows]);

  useLayoutEffect(() => {
    if (!grouped || searching) {
      placeGlow(makerGlow.current, null, true);
      return;
    }
    const options = ['all', ...makers] as const;
    const at = options.indexOf(maker);
    const button = at >= 0 ? (makerRefs.current[at] ?? null) : null;
    placeGlow(makerGlow.current, button, true);
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [grouped, searching, maker, makers]);

  // Без поиска клавиатуру держит сам список.
  useEffect(() => {
    if (!searchable) list.current?.focus();
  }, [searchable]);

  const step = (direction: 1 | -1) => {
    if (direction < 0 && active <= firstModel(rows) && models.assigned) {
      setActive(-1);
      return;
    }
    for (let at = active + direction; at >= 0 && at < rows.length; at += direction) {
      if (rows[at]?.kind === 'model') {
        setActive(at);
        return;
      }
    }
  };

  const pickMaker = (next: ManufacturerId | 'all') => {
    freshGlow.current = true;
    setMaker(next);
    setActive(firstModel(visibleRows(models, selected, query, next, grouped)));
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      step(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const indexes = rows.flatMap((row, at) => (row.kind === 'model' ? [at] : []));
      const next = event.key === 'Home' ? (models.assigned ? -1 : indexes[0]) : indexes.at(-1);
      if (next !== undefined) setActive(next);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (active < 0) {
        if (models.assigned) onUseDefault();
        return;
      }
      const row = rows[active];
      if (row?.kind === 'model') onPick(row.ref);
    }
  };

  const activeRow = rows[active];
  const activeId =
    active < 0 && models.assigned
      ? `${listId}-default`
      : activeRow?.kind === 'model'
        ? `${listId}-${active}`
        : undefined;

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
              freshGlow.current = true;
              setActive(firstModel(visibleRows(models, selected, next, maker, grouped)));
            }}
            onKeyDown={onKeyDown}
            className="h-9 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      ) : null}
      <div className={cn(styles.root, 'max-h-80')}>
        {grouped ? (
          <div
            className={styles.makers}
            aria-label={t('manufacturers')}
            onPointerLeave={() => {
              if (searching) return;
              const options = ['all', ...makers] as const;
              const at = options.indexOf(maker);
              placeGlow(makerGlow.current, at >= 0 ? (makerRefs.current[at] ?? null) : null, false);
            }}
          >
            <span ref={makerGlow} aria-hidden className={styles.glow} />
            {(['all', ...makers] as const).map((option, at) => (
              <button
                key={option}
                ref={(node) => {
                  makerRefs.current[at] = node;
                }}
                type="button"
                aria-pressed={maker === option && !searching}
                onPointerEnter={() =>
                  placeGlow(makerGlow.current, makerRefs.current[at] ?? null, false)
                }
                onFocus={() => placeGlow(makerGlow.current, makerRefs.current[at] ?? null, false)}
                onClick={() => pickMaker(option)}
                className={styles.maker}
              >
                <span className={styles.label}>
                  {option === 'all'
                    ? t('all')
                    : option === 'other'
                      ? t('families.other')
                      : MANUFACTURER_LABEL[option]}
                </span>
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
          className={styles.models}
        >
          <span ref={glow} aria-hidden className={styles.glow} />
          {models.assigned ? (
            <div
              ref={defaultRef}
              id={`${listId}-default`}
              role="option"
              aria-selected={followingDefault}
              tabIndex={active < 0 ? 0 : -1}
              onPointerEnter={() => {
                if (active !== -1) setActive(-1);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onUseDefault();
                } else {
                  onKeyDown(event);
                }
              }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onUseDefault}
              className={styles.fallback}
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
                <p key={row.key} role="presentation" className={styles.section}>
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
                  className={styles.model}
                >
                  <span className={styles.label}>{shortModelName(row.ref.modelId)}</span>
                  <CheckIcon
                    aria-hidden
                    className={cn(
                      styles.check,
                      !followingDefault && sameModel(row.ref, selected) && styles.checkOn,
                    )}
                  />
                </div>
              ),
            )
          )}
        </div>
      </div>
      {depth ? (
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
