'use client';

import dynamic from 'next/dynamic';

/** Swagger and its stylesheet load only on the console page. */
export const ApiConsole = dynamic(
  () => import('@/components/api-console').then((mod) => mod.ApiConsole),
  {
    ssr: false,
    loading: () => <p className="mt-6 text-sm text-fd-muted-foreground">Открываю справочник…</p>,
  },
);
