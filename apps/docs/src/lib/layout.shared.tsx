import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appUrl } from '@/lib/site';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'Документация',
      url: '/',
    },
    links: [
      {
        text: 'Приложение',
        url: appUrl(),
        external: true,
      },
    ],
  };
}
