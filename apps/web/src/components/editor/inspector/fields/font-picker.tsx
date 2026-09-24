'use client';

import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useVirtualizer } from '@tanstack/react-virtual';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, Search01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';
import {
  COMMON_FONTS,
  buildFontRows,
  cachedLocalFonts,
  canQueryLocalFonts,
  fontFamilyCss,
  loadLocalFonts,
  nextFontIndex,
  type FontRow,
} from '@/components/editor/inspector/fields/fonts';
import {
  FIELD_CLASS,
  FieldPopoverContent,
  useFocusReturn,
} from '@/components/editor/inspector/fields/field-chrome';

export interface FontPickerProps {
  /** Семейство; `null` — у выделенного разные шрифты или шрифт наследуется от шаблона. */
  value: string | null;
  /** Шрифты шаблона — первая группа списка. */
  templateFonts: readonly string[];
  onChange: (family: string | null) => void;
  /** Подпись поля при `value === null`: «Разные» или «Как в шаблоне». */
  placeholder: string;
  /** Пункт над списком, который возвращает шрифт шаблона (`onChange(null)`). Без него пункта нет. */
  resetLabel?: string;
  ariaLabel: string;
  disabled?: boolean;
}

const ROW_HEIGHT = 28;
const PAGE_ROWS = 8;

/**
 * Выбор шрифта как в Figma: поле с названием, нарисованным самим шрифтом; по нажатию —
 * поиск и список, сверху шрифты шаблона. Список виртуальный: шрифтов компьютера бывают
 * тысячи, а каждая строка рисуется своим шрифтом.
 */
export function FontPicker({
  value,
  templateFonts,
  onChange,
  placeholder,
  resetLabel,
  ariaLabel,
  disabled,
}: FontPickerProps) {
  const [open, setOpen] = useState(false);
  const focus = useFocusReturn({ focusOnOpen: true });

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={ariaLabel}
          title={value ?? placeholder}
          {...focus.trigger}
          className={cn(
            FIELD_CLASS,
            'w-full text-left outline-none focus-visible:ring-ring data-[state=open]:ring-ring',
            disabled && 'pointer-events-none opacity-50',
          )}
        >
          <span
            className={cn(
              'min-w-0 flex-1 truncate',
              value === null ? 'text-muted-foreground' : 'text-foreground',
            )}
            style={value === null ? undefined : { fontFamily: fontFamilyCss(value) }}
          >
            {value ?? placeholder}
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={12}
            strokeWidth={2}
            color="currentColor"
            className="shrink-0 text-muted-foreground"
          />
        </button>
      </PopoverPrimitive.Trigger>
      <FieldPopoverContent
        align="start"
        className="flex w-(--radix-popover-trigger-width) min-w-60 flex-col overflow-hidden"
        onOpenAutoFocus={focus.content.onOpenAutoFocus}
        onCloseAutoFocus={focus.content.onCloseAutoFocus}
        onInteractOutside={focus.content.onInteractOutside}
      >
        <FontSearch
          value={value}
          templateFonts={templateFonts}
          resetLabel={resetLabel}
          onPick={(family) => {
            setOpen(false);
            if (family !== value) onChange(family);
          }}
        />
      </FieldPopoverContent>
    </PopoverPrimitive.Root>
  );
}

type LocalState = 'idle' | 'loading' | 'loaded' | 'failed';

/** Содержимое поповера: живёт, только пока он открыт, — список и поиск каждый раз с нуля. */
function FontSearch({
  value,
  templateFonts,
  resetLabel,
  onPick,
}: {
  value: string | null;
  templateFonts: readonly string[];
  resetLabel?: string;
  onPick: (family: string | null) => void;
}) {
  const t = useTranslations('inspectorFields.font');
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [allFonts, setAllFonts] = useState<readonly string[]>(
    () => cachedLocalFonts() ?? COMMON_FONTS,
  );
  const [local, setLocal] = useState<LocalState>(() => (cachedLocalFonts() ? 'loaded' : 'idle'));
  const rows = useMemo(
    () => buildFontRows(templateFonts, allFonts, query),
    [templateFonts, allFonts, query],
  );
  const [active, setActive] = useState(() => initialActive(rows, value));

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
    initialOffset: Math.max(0, (active - 3) * ROW_HEIGHT),
  });

  const moveTo = (index: number) => {
    if (index < 0) return;
    setActive(index);
    virtualizer.scrollToIndex(index, { align: 'auto' });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const row = rows[active];
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveTo(nextFontIndex(rows, active, event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault();
      const direction = event.key === 'PageDown' ? 1 : -1;
      let index = active;
      for (let step = 0; step < PAGE_ROWS; step += 1) index = nextFontIndex(rows, index, direction);
      moveTo(index);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (row?.kind === 'font') onPick(row.family);
    }
  };

  const showLocalFonts = () => {
    setLocal('loading');
    loadLocalFonts()
      .then((fonts) => {
        setAllFonts(fonts);
        setLocal('loaded');
        setActive(initialActive(buildFontRows(templateFonts, fonts, query), value));
      })
      .catch(() => setLocal('failed'));
  };

  const activeRow = rows[active];

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-2.5">
        <HugeiconsIcon
          icon={Search01Icon}
          size={13}
          strokeWidth={1.5}
          color="currentColor"
          className="shrink-0 text-muted-foreground"
        />
        <input
          type="text"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={activeRow?.kind === 'font' ? `${listId}-${active}` : undefined}
          aria-label={t('search')}
          placeholder={t('search')}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setQuery(next);
            const nextRows = buildFontRows(templateFonts, allFonts, next);
            setActive(nextFontIndex(nextRows, -1, 1));
            virtualizer.scrollToOffset(0);
          }}
          onKeyDown={onKeyDown}
          className="h-8 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      {resetLabel ? (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(null)}
          className="mx-1 mt-1 flex h-7 items-center rounded-md px-2 text-left text-xs text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
        >
          {resetLabel}
        </button>
      ) : null}

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={t('list')}
        className="max-h-72 overflow-y-auto overscroll-contain p-1"
      >
        {rows.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">{t('notFound')}</p>
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              if (!row) return null;
              return (
                <div
                  key={item.key}
                  className="absolute top-0 left-0 w-full"
                  style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                >
                  {row.kind === 'header' ? (
                    <div
                      role="presentation"
                      className="flex h-full items-end px-2 pb-1 text-[11px] text-muted-foreground"
                    >
                      {row.group === 'template' ? t('templateFonts') : t('allFonts')}
                    </div>
                  ) : (
                    <FontOption
                      id={`${listId}-${item.index}`}
                      row={row}
                      selected={row.family === value}
                      active={item.index === active}
                      onHover={() => setActive(item.index)}
                      onPick={() => onPick(row.family)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-border p-1">
        {!canQueryLocalFonts() ? (
          <p className="px-2 py-1.5 text-[11px] text-muted-foreground">{t('localUnavailable')}</p>
        ) : local === 'loaded' ? null : (
          <button
            type="button"
            disabled={local === 'loading'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={showLocalFonts}
            className="flex h-7 w-full items-center rounded-md px-2 text-left text-xs text-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent disabled:opacity-60"
          >
            {local === 'loading' ? t('loadingLocal') : t('showLocal')}
          </button>
        )}
        {local === 'failed' ? (
          <p className="px-2 pb-1 text-[11px] text-muted-foreground">{t('localDenied')}</p>
        ) : null}
      </div>
    </>
  );
}

function FontOption({
  id,
  row,
  selected,
  active,
  onHover,
  onPick,
}: {
  id: string;
  row: Extract<FontRow, { kind: 'font' }>;
  selected: boolean;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      title={row.family}
      onMouseMove={onHover}
      // Строка не забирает фокус у поиска: стрелки и Enter продолжают работать.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPick}
      className={cn(
        'flex h-full cursor-default items-center gap-2 rounded-md pr-2 pl-2 text-[13px] text-foreground select-none',
        active && 'bg-accent text-accent-foreground',
      )}
    >
      <span className="min-w-0 flex-1 truncate" style={{ fontFamily: fontFamilyCss(row.family) }}>
        {row.family}
      </span>
      {selected ? (
        <HugeiconsIcon
          icon={Tick02Icon}
          size={13}
          strokeWidth={2}
          color="currentColor"
          className="shrink-0"
        />
      ) : null}
    </div>
  );
}

/** Где стоять курсору при открытии: на текущем шрифте, иначе на первом. */
function initialActive(rows: readonly FontRow[], value: string | null): number {
  if (value !== null) {
    const index = rows.findIndex((row) => row.kind === 'font' && row.family === value);
    if (index >= 0) return index;
  }
  return nextFontIndex(rows, -1, 1);
}
