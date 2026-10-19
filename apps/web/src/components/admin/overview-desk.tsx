'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { motion, useReducedMotion } from 'motion/react';
import { listUsersAction } from '@/app/users-actions';
import { SpinnerIcon } from '@/components/ui/icons';
import { ADMIN_VIEWS, type AdminView } from '@/lib/admin-views';
import type { ManagedUser } from '@/lib/users';
import { cn } from '@/lib/utils';

/**
 * Обзор установки: три счёта по аккаунтам и карточка на каждый раздел, кроме самого обзора.
 * Карточки берутся из реестра разделов, поэтому новый id появляется здесь сам.
 */
export function OverviewDesk({ onOpen }: { readonly onOpen: (view: AdminView) => void }) {
  const figures = useTranslations('admin.overview');
  const sections = useTranslations('admin.sections');
  const format = useFormatter();
  const reduce = useReducedMotion();
  const [users, setUsers] = useState<readonly ManagedUser[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    listUsersAction().then(
      (result) => {
        if (!live) return;
        if (result.ok) setUsers(result.users);
        else setFailed(true);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const accounts = users?.length ?? 0;
  const administrators = users?.filter((user) => user.role === 'admin').length ?? 0;
  const disabled = users?.filter((user) => user.disabled).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          {figures('loadFailed')}
        </p>
      ) : users === null ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <SpinnerIcon size={14} className="animate-spin motion-reduce:animate-none" />
          {figures('loading')}
        </p>
      ) : (
        <dl className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ['accounts', accounts],
              ['administrators', administrators],
              ['disabled', disabled],
            ] as const
          ).map(([key, count], index) => (
            <Figure
              key={key}
              index={index}
              reduce={reduce}
              label={figures(key)}
              value={format.number(count)}
            />
          ))}
        </dl>
      )}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ADMIN_VIEWS.filter(isSection).map((id, index) => (
          <motion.li
            key={id}
            className="min-w-0"
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: reduce ? 0 : 0.28,
              delay: reduce ? 0 : 0.08 + index * 0.05,
              ease,
            }}
          >
            <button
              type="button"
              onClick={() => onOpen(id)}
              className={cn(
                'flex h-full min-h-11 w-full flex-col items-start gap-1 rounded-xl p-4 text-left ring-1 ring-border outline-none',
                'transition-colors duration-150 motion-reduce:transition-none',
                'hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50',
              )}
            >
              <h2 className="text-sm font-medium">{sections(`${id}.title`)}</h2>
              <p className="text-sm text-pretty text-muted-foreground">{sections(`${id}.body`)}</p>
            </button>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

const ease = [0.16, 1, 0.3, 1] as const;

function isSection(id: AdminView): id is Exclude<AdminView, 'overview'> {
  return id !== 'overview';
}

function Figure({
  label,
  value,
  index,
  reduce,
}: {
  readonly label: string;
  readonly value: string;
  readonly index: number;
  readonly reduce: boolean | null;
}) {
  return (
    <motion.div
      className="rounded-xl px-4 py-3 ring-1 ring-border"
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.28, delay: reduce ? 0 : index * 0.04, ease }}
    >
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
    </motion.div>
  );
}
