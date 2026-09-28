'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Account } from '@/lib/auth';

const AccountContext = createContext<Account | null>(null);

/**
 * Аккаунт этого запроса для клиентских компонентов вне главного меню — окна настроек, которое
 * открывается на любой странице. На странице входа аккаунта нет: null.
 */
export function AccountProvider({
  account,
  children,
}: {
  account: Account | null;
  children: ReactNode;
}) {
  return <AccountContext value={account}>{children}</AccountContext>;
}

export function useAccount(): Account | null {
  return useContext(AccountContext);
}
