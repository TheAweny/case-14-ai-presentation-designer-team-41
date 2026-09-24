'use client';

import { Fragment, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { HugeiconsIcon } from '@hugeicons/react';
import { Search01Icon } from '@hugeicons/core-free-icons';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import {
  SHORTCUT_GROUPS,
  SHORTCUTS,
  isMacPlatform,
  shortcutDisplays,
  shortcutLabel,
  type ShortcutGroup,
} from '@/components/editor/editor-shortcuts';
import { RAIL_SHORTCUTS } from '@/components/editor/tool-rail';

interface Row {
  readonly key: string;
  readonly label: string;
  readonly keys: readonly (readonly string[])[];
}

/** Одно сочетание: по клавише на каждую часть, как в подсказках рейки. */
function Keys({ keys, mac }: { keys: readonly string[]; mac: boolean }) {
  return (
    <span className="flex items-center gap-0.5">
      {keys.map((key, index) => (
        <Kbd key={`${key}-${index}`}>{shortcutLabel([key], mac)}</Kbd>
      ))}
    </span>
  );
}

/**
 * Шпаргалка по горячим клавишам: Ctrl+/ или «?». Список строится из реестра сочетаний, тот же,
 * по которому редактор их слушает, — подписи не расходятся с делом. Инструменты рейки — из
 * самой рейки.
 */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('shortcuts');
  const rail = useTranslations('toolRail');
  const [query, setQuery] = useState('');
  const mac = open && isMacPlatform();

  const groups = useMemo(() => {
    const byGroup: [ShortcutGroup | 'tools', Row[]][] = SHORTCUT_GROUPS.map((group) => [
      group,
      SHORTCUTS.filter((spec) => spec.group === group).map((spec) => ({
        key: spec.id,
        label: t(`items.${spec.id}`),
        keys: shortcutDisplays(spec.id),
      })),
    ]);
    byGroup.push([
      'tools',
      RAIL_SHORTCUTS.map((entry) => ({
        key: `tool-${entry.id}`,
        label: entry.kind === 'variant' ? rail(`variants.${entry.id}`) : rail(`tools.${entry.id}`),
        keys: [[entry.key]],
      })),
    ]);
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return byGroup;
    return byGroup
      .map(([group, rows]): [ShortcutGroup | 'tools', Row[]] => [
        group,
        rows.filter(
          (row) =>
            row.label.toLocaleLowerCase().includes(needle) ||
            row.keys.some((keys) => shortcutLabel(keys, mac).toLocaleLowerCase().includes(needle)),
        ),
      ])
      .filter(([, rows]) => rows.length > 0);
  }, [mac, query, rail, t]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery('');
        onOpenChange(next);
      }}
    >
      <DialogContent
        closeLabel={t('close')}
        className="max-h-[min(40rem,calc(100dvh-2rem))] max-w-3xl grid-rows-[auto_auto_minmax(0,1fr)]"
      >
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <label
          className={cn(
            'flex h-8 items-center gap-2 rounded-lg px-2 ring-1 ring-border',
            'focus-within:ring-2 focus-within:ring-ring/50',
          )}
        >
          <HugeiconsIcon
            icon={Search01Icon}
            size={14}
            strokeWidth={1.75}
            color="currentColor"
            className="shrink-0 text-muted-foreground"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </label>
        <div className="min-h-0 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]">
          {groups.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">{t('empty')}</p>
          ) : (
            <div className="columns-1 gap-6 sm:columns-2">
              {groups.map(([group, rows]) => (
                <section key={group} className="mb-4 break-inside-avoid">
                  <h3 className="mb-1.5 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">
                    {t(`groups.${group}`)}
                  </h3>
                  <dl className="grid gap-1">
                    {rows.map((row) => (
                      <div
                        key={row.key}
                        className="flex min-h-6 items-center justify-between gap-3 text-xs"
                      >
                        <dt className="min-w-0">{row.label}</dt>
                        <dd className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                          {row.keys.map((keys, index) => (
                            <Fragment key={keys.join('+')}>
                              {index > 0 ? (
                                <span className="text-[0.625rem] text-muted-foreground">
                                  {t('or')}
                                </span>
                              ) : null}
                              <Keys keys={keys} mac={mac} />
                            </Fragment>
                          ))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
