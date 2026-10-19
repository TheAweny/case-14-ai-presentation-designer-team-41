'use client';

import { type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { UsersSettingsPanel } from '@/components/settings/users-settings-panel';
import { ADMIN_VIEWS, adminView, type AdminView } from '@/lib/admin-views';
import { cn } from '@/lib/utils';
import { LimitsDesk } from './limits-desk';
import { MetricsDesk } from './metrics-desk';
import { OverviewDesk } from './overview-desk';

const ease = [0.16, 1, 0.3, 1] as const;

type PanelProps = { readonly onOpen: (view: AdminView) => void };

/** Карта разделов. Тип не соберётся, если для id из ADMIN_VIEWS нет панели. */
const PANELS: Record<AdminView, (props: PanelProps) => ReactNode> = {
  overview: OverviewDesk,
  people: () => <UsersSettingsPanel />,
  limits: () => <LimitsDesk />,
  metrics: () => <MetricsDesk />,
};

/**
 * Панель администратора. Раздел живёт в адресе (`?view=limits`), чтобы на него можно было
 * дать ссылку. Без параметра и с незнакомым значением открывается обзор. Смена раздела —
 * короткий сдвиг, без скачка вёрстки.
 */
export function AdminDashboard() {
  const t = useTranslations('admin');
  const params = useSearchParams();
  const router = useRouter();
  const reduce = useReducedMotion();
  const view = adminView(params.get('view'));
  const Panel = PANELS[view];

  const open = (next: AdminView) => {
    const url = new URL(window.location.href);
    if (next === 'overview') url.searchParams.delete('view');
    else url.searchParams.set('view', next);
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  };

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <motion.header
        className="grid max-w-2xl gap-1"
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduce ? 0 : 0.32, ease }}
      >
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </motion.header>
      <ViewSwitch value={view} onChange={open} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={view}
          role="tabpanel"
          id={`admin-view-${view}`}
          aria-labelledby={`admin-tab-${view}`}
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -8 }}
          transition={{ duration: reduce ? 0 : 0.22, ease }}
        >
          <Panel onOpen={open} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function ViewSwitch({
  value,
  onChange,
}: {
  value: AdminView;
  onChange: (view: AdminView) => void;
}) {
  const t = useTranslations('admin.views');
  const reduce = useReducedMotion();
  return (
    <div className="max-w-full min-w-0 overflow-x-auto [scrollbar-width:thin]">
      <div
        role="tablist"
        aria-label={t('label')}
        className="inline-flex w-max flex-nowrap rounded-lg bg-muted p-0.5"
      >
        {ADMIN_VIEWS.map((id) => {
          const selected = value === id;
          return (
            <button
              key={id}
              id={`admin-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`admin-view-${id}`}
              onClick={() => onChange(id)}
              className={cn(
                'relative h-11 shrink-0 rounded-md px-3 text-sm whitespace-nowrap outline-none md:h-8',
                'focus-visible:ring-2 focus-visible:ring-ring/50',
                selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {selected ? (
                <motion.span
                  layoutId="admin-view-pill"
                  className="absolute inset-0 rounded-md bg-background shadow-sm"
                  transition={{ duration: reduce ? 0 : 0.28, ease }}
                />
              ) : null}
              <span className="relative">{t(id)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
