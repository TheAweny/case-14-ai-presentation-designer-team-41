import { getTranslations } from 'next-intl/server';
import { PageSplash } from '@/components/page-splash';

/**
 * Пока сервер собирает колоду. Это первая стадия заставки редактора: `DeckEditor` продолжает
 * её тем же элементом на экране, пока ждёт шрифты, картинки и черновик.
 */
export default async function DeckLoading() {
  const t = await getTranslations('splash');
  return <PageSplash label={t('deck')} progress={0} />;
}
