'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { HugeiconsIcon } from '@hugeicons/react';
import { Logout03Icon } from '@hugeicons/core-free-icons';
import { signOutAction } from '@/app/auth-actions';
import { AccountAvatar } from '@/components/auth/account-menu';
import { Button } from '@/components/ui/button';
import type { Account } from '@/lib/auth';

/**
 * «Аккаунт»: кто вошёл и выход. Имя, почту и пароль меняет администратор — аккаунты заводятся
 * вне приложения, поэтому полей для правки здесь нет, есть только подсказка, к кому идти.
 */
export function AccountSettingsPanel({ account }: { account: Account }) {
  const t = useTranslations('settings.account');
  const [leaving, startLeaving] = useTransition();

  return (
    <div className="flex flex-col gap-6 px-5 py-5 md:px-7 md:pt-6">
      <h2 className="text-base font-semibold md:pr-8">{t('title')}</h2>

      <div className="flex items-center gap-4">
        <AccountAvatar account={account} className="size-14 text-lg" />
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate text-base font-medium">{account.name}</span>
          <span className="truncate text-sm text-muted-foreground">{account.email}</span>
        </div>
      </div>

      <p className="border-b border-border pb-4 text-xs text-muted-foreground">{t('managed')}</p>

      <div className="flex items-center justify-between gap-4">
        <span className="text-sm">{t('signOutHint')}</span>
        <Button
          variant="outline"
          size="lg"
          disabled={leaving}
          onClick={() => startLeaving(() => signOutAction())}
        >
          <HugeiconsIcon icon={Logout03Icon} strokeWidth={1.5} data-icon="inline-start" />
          {t('signOut')}
        </Button>
      </div>
    </div>
  );
}
