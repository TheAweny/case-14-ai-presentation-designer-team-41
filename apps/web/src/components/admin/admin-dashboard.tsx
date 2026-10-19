'use client';

import { useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { UsersSettingsPanel } from '@/components/settings/users-settings-panel';
import { ADMIN_VIEWS, adminView, type AdminView } from '@/lib/admin-views';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LimitsDesk } from './limits-desk';
import { MetricsDesk } from './metrics-desk';
import { OverviewDesk } from './overview-desk';

const ease = [0.16, 1, 0.3, 1] as const;

type PanelProps = {
  readonly onOpen: (view: AdminView, accountId?: string) => void;
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly accountId: string | null;
};

/** Карта разделов. Тип не соберётся, если для id из ADMIN_VIEWS нет панели. */
const PANELS: Record<AdminView, (props: PanelProps) => ReactNode> = {
  overview: OverviewDesk,
  people: ({ onOpen, onDirtyChange }) => (
    <UsersSettingsPanel onLimits={(id) => onOpen('limits', id)} onDirtyChange={onDirtyChange} />
  ),
  limits: ({ accountId, onDirtyChange }) => (
    <LimitsDesk initialScope={accountId} onDirtyChange={onDirtyChange} />
  ),
  metrics: MetricsDesk,
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
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<{ view: AdminView; accountId?: string } | null>(null);
  const view = adminView(params.get('view'));
  const Panel = PANELS[view];

  const navigate = (next: AdminView, accountId?: string) => {
    const url = new URL(window.location.href);
    if (next === 'overview') url.searchParams.delete('view');
    else url.searchParams.set('view', next);
    if (accountId) url.searchParams.set('account', accountId);
    else url.searchParams.delete('account');
    setDirty(false);
    setPending(null);
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  };
  const open = (next: AdminView, accountId?: string) => {
    if (next === view && !accountId) return;
    if (dirty) setPending({ view: next, accountId });
    else navigate(next, accountId);
  };

  return (
    <div className="flex min-w-0 flex-col gap-8 max-md:[&_button[data-slot=button]]:min-h-11 max-md:[&_button[data-slot=button]]:min-w-11 max-md:[&_input:not([type=radio]):not([type=checkbox])]:min-h-11 max-md:[&_input]:text-base max-md:[&_select]:min-h-11 max-md:[&_select]:text-base">
      <motion.header
        className="grid max-w-2xl gap-1"
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduce ? 0 : 0.32, ease }}
      >
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </motion.header>
      <Tabs value={view} onValueChange={(value) => open(adminView(value))} className="gap-6">
        <ViewSwitch />
        {pending ? (
          <div role="alert" className="grid gap-3 rounded-lg border border-border p-4">
            <p className="text-sm">{t('unsaved')}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setPending(null)}>
                {t('keepEditing')}
              </Button>
              <Button
                variant="destructive"
                onClick={() => navigate(pending.view, pending.accountId)}
              >
                {t('discardAndOpen')}
              </Button>
            </div>
          </div>
        ) : null}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view}
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: reduce ? 0 : 0.22, ease }}
          >
            <TabsContent value={view}>
              <Panel onOpen={open} onDirtyChange={setDirty} accountId={params.get('account')} />
            </TabsContent>
          </motion.div>
        </AnimatePresence>
      </Tabs>
    </div>
  );
}

function ViewSwitch() {
  const t = useTranslations('admin.views');
  return (
    <div className="max-w-full min-w-0 overflow-x-auto [scrollbar-width:thin]">
      <TabsList
        aria-label={t('label')}
        className="inline-flex w-max flex-nowrap rounded-lg bg-muted p-0.5"
      >
        {ADMIN_VIEWS.map((id) => {
          return (
            <TabsTrigger
              key={id}
              value={id}
              className={cn(
                'relative h-11 shrink-0 rounded-md px-3 text-sm whitespace-nowrap outline-none md:h-8',
                'focus-visible:ring-2 focus-visible:ring-ring/50',
              )}
            >
              <span className="relative">{t(id)}</span>
            </TabsTrigger>
          );
        })}
      </TabsList>
    </div>
  );
}
