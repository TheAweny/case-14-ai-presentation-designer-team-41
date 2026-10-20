import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { DocsAccountSlot } from '@/components/account';
import { appUrl } from '@/lib/site';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'Документация',
      url: '/',
    },
    // The portal stays dark. The slot that used to switch theme is the signed-in account.
    themeSwitch: { enabled: true },
    slots: { themeSwitch: DocsAccountSlot },
    links: [
      {
        text: 'Приложение',
        url: appUrl(),
        external: true,
      },
    ],
  };
}
