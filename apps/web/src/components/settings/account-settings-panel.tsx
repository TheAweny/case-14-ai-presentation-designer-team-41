'use client';

import { useId, useState, useTransition, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { LogoutIcon } from '@/components/ui/icons';
import { signOutAction } from '@/app/auth-actions';
import { changeOwnPasswordAction } from '@/app/users-actions';
import { MAX_PASSWORD_LENGTH, passwordProblem } from '@/lib/users';
import { cn } from '@/lib/utils';
import { AccountAvatar } from '@/components/auth/account-menu';
import { Button } from '@/components/ui/button';
import { AvatarPicker } from './avatar-picker';
import type { Account } from '@/lib/auth';
import { AccountPolicyPanel } from './account-policy-panel';

/**
 * «Аккаунт»: кто вошёл, своя картинка, смена своего пароля и выход. Имя и почту меняет администратор
 * на панели администрирования.
 */
export function AccountSettingsPanel({ account }: { account: Account }) {
  const t = useTranslations('settings.account');
  const [leaving, startLeaving] = useTransition();

  return (
    <div className="flex flex-col gap-6 px-5 py-5 md:px-7 md:pt-6">
      <h2 className="text-base font-semibold md:pr-8">{t('title')}</h2>

      <div className="flex items-center gap-4">
        <AccountAvatar account={account} className="size-14" />
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate text-base font-medium">{account.name}</span>
          <span className="truncate text-sm text-muted-foreground">{account.email}</span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{t('managed')}</p>

      <div className="border-b border-border pb-5">
        <AvatarPicker account={account} />
      </div>

      <ChangePassword />
      <AccountPolicyPanel />

      <div className="flex items-center justify-between gap-4">
        <span className="text-sm">{t('signOutHint')}</span>
        <Button
          variant="outline"
          size="lg"
          disabled={leaving}
          onClick={() => startLeaving(() => signOutAction())}
        >
          <LogoutIcon data-icon="inline-start" />
          {t('signOut')}
        </Button>
      </div>
    </div>
  );
}

const inputClass = cn(
  'h-9 w-full rounded-md bg-background px-2.5 text-sm text-foreground outline-none',
  'ring-1 ring-border placeholder:text-muted-foreground focus:ring-2 focus:ring-ring',
  'aria-invalid:ring-destructive',
);

/** Смена своего пароля: текущий и новый. Новый проверяется до отправки по правилам API. */
function ChangePassword() {
  const t = useTranslations('settings.account.password');
  const ids = { current: useId(), next: useId() };
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saving, startSaving] = useTransition();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problem = passwordProblem(next);
    if (problem === 'passwordShort' || problem === 'passwordLong') {
      setMessage({ kind: 'error', text: t(problem) });
      return;
    }
    startSaving(async () => {
      const result = await changeOwnPasswordAction(current, next).catch(() => null);
      if (result?.ok) {
        setCurrent('');
        setNext('');
        setMessage({ kind: 'ok', text: t('changed') });
      } else {
        setMessage({
          kind: 'error',
          text: result?.reason === 'invalid' ? t('wrongCurrent') : t('failed'),
        });
      }
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 border-b border-border pb-5">
      <h3 className="text-sm font-medium">{t('title')}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor={ids.current} className="text-xs text-muted-foreground">
            {t('current')}
          </label>
          <input
            id={ids.current}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.currentTarget.value)}
            className={inputClass}
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={ids.next} className="text-xs text-muted-foreground">
            {t('next')}
          </label>
          <input
            id={ids.next}
            type="password"
            autoComplete="new-password"
            maxLength={MAX_PASSWORD_LENGTH}
            value={next}
            onChange={(event) => setNext(event.currentTarget.value)}
            className={inputClass}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p
          aria-live="polite"
          className={cn(
            'text-xs',
            message?.kind === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {message?.text ?? t('hint')}
        </p>
        <Button type="submit" variant="outline" disabled={saving || current === '' || next === ''}>
          {t('save')}
        </Button>
      </div>
    </form>
  );
}
