import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';

/**
 * Неизвестный адрес и `notFound()` со страниц, например колоды, которой нет. Тот же «горизонт»,
 * что на входе, только без реакции на курсор: здесь человеку нужна одна кнопка, а не сцена.
 */
export default async function NotFound() {
  const t = await getTranslations('notFound');
  return (
    <main className="horizon-scene relative isolate grid min-h-dvh place-items-center overflow-hidden bg-background px-4 pt-12 text-foreground">
      <div aria-hidden className="horizon-stars" />
      <div aria-hidden className="horizon-beam" />
      <div aria-hidden className="horizon-planet" />

      <div className="flex w-full max-w-[22.5rem] flex-col items-center text-center animate-in duration-700 fade-in slide-in-from-bottom-2 motion-reduce:animate-none">
        <p
          aria-hidden
          className="bg-linear-to-b from-foreground from-30% to-[oklch(0.8_0.08_290)] bg-clip-text text-7xl leading-none font-semibold tracking-tight text-transparent tabular-nums"
        >
          404
        </p>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-2 text-sm text-balance text-muted-foreground">{t('description')}</p>
        <Button asChild size="lg" className="mt-8 h-10 px-4 text-sm">
          <Link href="/">{t('home')}</Link>
        </Button>
      </div>
    </main>
  );
}
