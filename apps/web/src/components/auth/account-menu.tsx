'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { LogoutIcon, SelectorIcon, SettingsIcon, UserIcon } from '@/components/ui/icons';
import { signOutAction } from '@/app/auth-actions';
import { openSettings, useIsMac } from '@/components/settings/open-settings';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Account } from '@/lib/auth';
import { avatarView } from '@/lib/avatars';
import { AvatarMark } from './avatar-mark';
import { cn } from '@/lib/utils';

/**
 * Аватар аккаунта: своё фото или один из десяти портретов, свой у каждого человека. Портрет
 * подбирается по id, пока человек не выбрал другой в настройках.
 */
export function AccountAvatar({
  account,
  className,
}: {
  account: Pick<Account, 'userId' | 'avatar'>;
  className?: string;
}) {
  const view = avatarView(account.avatar, account.userId);
  return (
    <span
      aria-hidden
      className={cn(
        'block size-6 shrink-0 overflow-hidden rounded-full ring-1 ring-black/5 dark:ring-white/10',
        className,
      )}
    >
      {view.kind === 'image' ? (
        // Картинка — уже квадрат 256 px из браузера: оптимизация Next ей не нужна.
        <img src={view.src} alt="" className="block size-full object-cover" draggable={false} />
      ) : (
        <AvatarMark index={view.index} />
      )}
    </span>
  );
}

/**
 * Аккаунт в подвале сайдбара: аватар и имя, по нажатию — меню с почтой, настройками и выходом,
 * как в Claude и Linear. В мобильной шапке места мало — там один аватар (`compact`).
 */
export function AccountMenu({
  account,
  compact = false,
  className,
}: {
  account: Account;
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations('auth.account');
  const mac = useIsMac();
  const [leaving, startLeaving] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={compact ? `${t('label')}: ${account.name}` : undefined}
        title={compact ? account.name : undefined}
        className={cn(
          'flex items-center gap-2 rounded-md text-sm outline-none',
          'transition-colors duration-100 motion-reduce:transition-none',
          'hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-muted',
          compact ? 'size-7 justify-center' : 'h-8 min-w-0 px-1.5 text-left',
          className,
        )}
      >
        <AccountAvatar account={account} className={compact ? 'size-6' : undefined} />
        {compact ? null : (
          <>
            <span className="min-w-0 flex-1 truncate">{account.name}</span>
            <SelectorIcon size={14} className="shrink-0 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={compact ? 'bottom' : 'top'}
        align={compact ? 'end' : 'start'}
        className="w-60"
      >
        <DropdownMenuLabel className="flex items-center gap-2.5 py-1.5 font-normal">
          <AccountAvatar account={account} className="size-8" />
          <span className="grid min-w-0">
            <span className="truncate text-sm font-medium text-foreground">{account.name}</span>
            <span className="truncate text-xs text-muted-foreground">{account.email}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openSettings('account')}>
          <UserIcon />
          {t('account')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openSettings()}>
          <SettingsIcon />
          {t('settings')}
          <DropdownMenuShortcut>{mac ? '⌘,' : 'Ctrl+,'}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={leaving} onSelect={() => startLeaving(() => signOutAction())}>
          <LogoutIcon />
          {t('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
