'use client';

import { useEffect, useId, useState, useTransition, type FormEvent } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  createUserAction,
  deleteUserAction,
  listUsersAction,
  updateUserAction,
  type UsersFailure,
  type UsersResult,
} from '@/app/users-actions';
import { AccountAvatar } from '@/components/auth/account-menu';
import { useAccount } from '@/components/auth/account-context';
import { ConfirmDeleteDialog } from '@/components/library/object-dialogs';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CopyIcon, MoreIcon, PlusIcon, SpinnerIcon } from '@/components/ui/icons';
import {
  emailProblem,
  generatePassword,
  MAX_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  nameProblem,
  passwordProblem,
  type ManagedUser,
} from '@/lib/users';
import { cn } from '@/lib/utils';
import { SectionHeader } from './settings-rows';

const inputClass = cn(
  'h-9 w-full rounded-md bg-background px-2.5 text-sm text-foreground outline-none',
  'ring-1 ring-border placeholder:text-muted-foreground focus:ring-2 focus:ring-ring',
  'aria-invalid:ring-destructive',
);

const newPassword = () => generatePassword((bytes) => crypto.getRandomValues(bytes));

/** Пароль, который администратор должен передать человеку: показывается один раз. */
interface IssuedPassword {
  readonly email: string;
  readonly password: string;
}

/**
 * «Пользователи» — только у администратора. Регистрации нет: аккаунты заводятся здесь. Отключить
 * — человек не войдёт, его презентации целы; удалить — вместе с презентациями, чатами и
 * шаблонами (кроме общих). Себя разжаловать, отключить и удалить нельзя, последний
 * администратор остаётся всегда — это проверяет API.
 */
export function UsersSettingsPanel() {
  const t = useTranslations('settings.users');
  const me = useAccount();
  const [users, setUsers] = useState<readonly ManagedUser[] | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [issued, setIssued] = useState<IssuedPassword | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ManagedUser | null>(null);
  const [busy, startBusy] = useTransition();

  const failureText = (failure: UsersFailure) =>
    failure.reason === 'exists'
      ? t('errors.exists')
      : failure.reason === 'forbidden'
        ? t('errors.forbidden')
        : (failure.message ?? t('errors.failed'));

  const apply = (result: UsersResult, ok?: string) => {
    if (result.ok) {
      setUsers(result.users);
      if (ok) setStatus({ kind: 'ok', text: ok });
    } else {
      setStatus({ kind: 'error', text: failureText(result) });
    }
    return result.ok;
  };

  useEffect(() => {
    let live = true;
    listUsersAction().then(
      (result) => live && apply(result),
      () => live && setStatus({ kind: 'error', text: t('errors.failed') }),
    );
    return () => {
      live = false;
    };
    // Список грузится один раз при открытии раздела.
  }, []);

  const change = (
    user: ManagedUser,
    patch: Parameters<typeof updateUserAction>[1],
    ok: string,
    password?: string,
  ) =>
    startBusy(async () => {
      setIssued(null);
      const result = await updateUserAction(user.userId, patch).catch((): UsersResult => ({
        ok: false,
        reason: 'failed',
      }));
      if (apply(result, ok) && password) setIssued({ email: user.email, password });
    });

  const remove = (user: ManagedUser) =>
    startBusy(async () => {
      setIssued(null);
      const result = await deleteUserAction(user.userId).catch((): UsersResult => ({
        ok: false,
        reason: 'failed',
      }));
      apply(result, t('deleted', { email: user.email }));
    });

  return (
    <div className="flex flex-col gap-6 px-5 py-5 md:px-7 md:pt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader title={t('title')} description={t('description')} />
        {adding ? null : (
          <Button variant="outline" onClick={() => setAdding(true)}>
            <PlusIcon data-icon="inline-start" />
            {t('add')}
          </Button>
        )}
      </div>

      {adding ? (
        <NewUserForm
          onCancel={() => setAdding(false)}
          onCreated={(result, created) => {
            if (apply(result, t('created', { email: created.email }))) {
              setIssued(created);
              setAdding(false);
            }
          }}
        />
      ) : null}

      <p aria-live="polite" className="sr-only">
        {status?.text}
      </p>
      {status ? (
        <p
          className={cn(
            'text-sm',
            status.kind === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {status.text}
        </p>
      ) : null}
      {issued ? <IssuedPasswordNote issued={issued} onDismiss={() => setIssued(null)} /> : null}

      {users === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <SpinnerIcon size={16} className="animate-spin" />
          {t('loading')}
        </div>
      ) : (
        <ul aria-label={t('listLabel')} className="flex flex-col">
          {users.map((user) => (
            <UserRow
              key={user.userId}
              user={user}
              self={user.userId === me?.userId}
              busy={busy}
              onRole={(role) =>
                change(
                  user,
                  { role },
                  t(role === 'admin' ? 'madeAdmin' : 'madeUser', { email: user.email }),
                )
              }
              onDisabled={(disabled) =>
                change(
                  user,
                  { disabled },
                  t(disabled ? 'disabledNotice' : 'enabledNotice', { email: user.email }),
                )
              }
              onResetPassword={() => {
                const password = newPassword();
                change(user, { password }, t('passwordReset', { email: user.email }), password);
              }}
              onDelete={() => setRemoving(user)}
            />
          ))}
        </ul>
      )}

      <ConfirmDeleteDialog
        open={removing !== null}
        onOpenChange={(open) => (open ? null : setRemoving(null))}
        title={t('deleteTitle')}
        body={t('deleteBody', { email: removing?.email ?? '' })}
        confirmLabel={t('deleteConfirm')}
        onConfirm={() => removing && remove(removing)}
        onCloseAutoFocus={() => undefined}
      />
    </div>
  );
}

function UserRow({
  user,
  self,
  busy,
  onRole,
  onDisabled,
  onResetPassword,
  onDelete,
}: {
  user: ManagedUser;
  /** Это аккаунт, под которым вошли: себя не разжаловать, не отключить и не удалить. */
  self: boolean;
  busy: boolean;
  onRole: (role: 'admin' | 'user') => void;
  onDisabled: (disabled: boolean) => void;
  onResetPassword: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('settings.users');
  const format = useFormatter();
  return (
    <li
      className={cn(
        'flex min-h-14 items-center gap-3 border-b border-border py-2.5',
        user.disabled && 'opacity-60',
      )}
    >
      <AccountAvatar account={user} className="size-8" />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{user.name}</span>
          {self ? <Badge>{t('you')}</Badge> : null}
          {user.role === 'admin' ? <Badge>{t('admin')}</Badge> : null}
          {user.disabled ? <Badge>{t('disabled')}</Badge> : null}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {user.email} ·{' '}
          {t('since', { date: format.dateTime(user.createdAt, { dateStyle: 'medium' }) })}
        </span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-label={t('menu', { email: user.email })}
          >
            <MoreIcon size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={onResetPassword}>{t('resetPassword')}</DropdownMenuItem>
          {self ? null : (
            <>
              <DropdownMenuItem onSelect={() => onRole(user.role === 'admin' ? 'user' : 'admin')}>
                {t(user.role === 'admin' ? 'makeUser' : 'makeAdmin')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onDisabled(!user.disabled)}>
                {t(user.disabled ? 'enable' : 'disable')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                {t('delete')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="shrink-0 rounded-full px-1.5 py-px text-[0.6875rem] text-muted-foreground ring-1 ring-border">
      {children}
    </span>
  );
}

/** Новый пароль виден один раз: его копируют и передают человеку. */
function IssuedPasswordNote({
  issued,
  onDismiss,
}: {
  issued: IssuedPassword;
  onDismiss: () => void;
}) {
  const t = useTranslations('settings.users');
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-lg p-3 ring-1 ring-border">
      <p className="text-sm">{t('issued', { email: issued.email })}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-md bg-muted px-2 py-1 font-mono text-sm select-all">
          {issued.password}
        </code>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            void navigator.clipboard.writeText(issued.password).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          <CopyIcon data-icon="inline-start" />
          {copied ? t('copied') : t('copy')}
        </Button>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onDismiss}>
          {t('hide')}
        </Button>
      </div>
    </div>
  );
}

function NewUserForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (result: UsersResult, issued: IssuedPassword) => void;
}) {
  const t = useTranslations('settings.users');
  const ids = { email: useId(), name: useId(), password: useId() };
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState(newPassword);
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [tried, setTried] = useState(false);
  const [saving, startSaving] = useTransition();
  const problems = {
    email: emailProblem(email),
    name: nameProblem(name),
    password: passwordProblem(password),
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (problems.email || problems.name || problems.password) return;
    const input = { email: email.trim(), name: name.trim(), password, role };
    startSaving(async () => {
      const result = await createUserAction(input).catch((): UsersResult => ({
        ok: false,
        reason: 'failed',
      }));
      onCreated(result, { email: input.email, password });
    });
  };

  const problemOf = (key: keyof typeof problems) => {
    const problem = problems[key];
    return tried && problem ? (
      <p id={`${ids[key]}-problem`} role="alert" className="text-xs text-destructive">
        {t(`problems.${problem}`)}
      </p>
    ) : null;
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      className="grid gap-4 rounded-lg p-4 ring-1 ring-border sm:grid-cols-2"
    >
      <div className="grid gap-1.5">
        <label htmlFor={ids.email} className="text-xs text-muted-foreground">
          {t('fields.email')}
        </label>
        <input
          id={ids.email}
          type="email"
          autoComplete="off"
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
          aria-invalid={tried && problems.email ? true : undefined}
          className={inputClass}
        />
        {problemOf('email')}
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={ids.name} className="text-xs text-muted-foreground">
          {t('fields.name')}
        </label>
        <input
          id={ids.name}
          autoComplete="off"
          maxLength={MAX_NAME_LENGTH}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          aria-invalid={tried && problems.name ? true : undefined}
          className={inputClass}
        />
        {problemOf('name')}
      </div>
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor={ids.password} className="text-xs text-muted-foreground">
            {t('fields.password')}
          </label>
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => setPassword(newPassword())}
          >
            {t('generate')}
          </button>
        </div>
        <input
          id={ids.password}
          autoComplete="new-password"
          maxLength={MAX_PASSWORD_LENGTH}
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          aria-invalid={tried && problems.password ? true : undefined}
          className={cn(inputClass, 'font-mono')}
        />
        {problemOf('password')}
      </div>
      <fieldset className="grid gap-1.5">
        <legend className="pb-1.5 text-xs text-muted-foreground">{t('fields.role')}</legend>
        <div className="flex h-9 items-center gap-4">
          {(['user', 'admin'] as const).map((option) => (
            <label key={option} className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="role"
                value={option}
                checked={role === option}
                onChange={() => setRole(option)}
                className="accent-foreground"
              />
              {t(`roles.${option}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? <SpinnerIcon className="animate-spin" data-icon="inline-start" /> : null}
          {t('create')}
        </Button>
      </div>
    </form>
  );
}
