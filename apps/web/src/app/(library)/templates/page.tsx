import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PaletteIcon, TemplateIcon } from '@/components/ui/icons';
import { EmptyState, LibraryPage } from '@/components/library/page-parts';
import { TemplatePanel } from '@/components/project/template-panel';
import { templateThumbOf } from '@/components/project/template-thumb';
import { TemplateLibrary, TemplateUpload } from '@/components/templates/template-library';
import { BrandbookLibrary, BrandbookUpload } from '@/components/templates/brandbook-library';
import { BrandbookPanel } from '@/components/templates/brandbook-panel';
import { listBrandbooks } from '@/lib/brandbook-library';
import { librarySource } from '@/mocks/sources';
import { requireAccount } from '../../auth-session';

export async function generateMetadata(): Promise<Metadata> {
  const [t, tMeta] = await Promise.all([
    getTranslations('templatesPage'),
    getTranslations('metadata'),
  ]);
  return { title: t('documentTitle', { app: tMeta('title') }) };
}

/**
 * Библиотека шаблонов аккаунта: свои и те, что администратор открыл всем. Здесь шаблон
 * загружают, переименовывают, удаляют и смотрят его профиль. Профиль рисует сервер — только у
 * раскрытого шаблона (`?template=`): галерея макетов каждого шаблона странице ни к чему.
 * Ниже — брендбуки: их загружают, смотрят разобранными (`?brandbook=`) и выбирают потом в поле
 * генерации рядом с шаблоном.
 */
export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string | string[]; brandbook?: string | string[] }>;
}) {
  const [t, tb, account, templates, brandbooks, params] = await Promise.all([
    getTranslations('templatesPage'),
    getTranslations('brandbooksPage'),
    requireAccount(),
    librarySource.listTemplates(),
    listBrandbooks(),
    searchParams,
  ]);
  const requested = typeof params.template === 'string' ? params.template : null;
  const selected = templates.find((template) => template.templateId === requested) ?? null;
  const requestedBrandbook = typeof params.brandbook === 'string' ? params.brandbook : null;
  const selectedBrandbook =
    brandbooks.find((brandbook) => brandbook.brandbookId === requestedBrandbook) ?? null;

  return (
    <LibraryPage>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="max-w-xl text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <TemplateUpload className="w-full shrink-0 sm:w-auto" />
      </header>

      {templates.length > 0 ? (
        <TemplateLibrary
          templates={templates.map((template) => ({
            ...templateThumbOf(template),
            shared: template.shared ?? false,
            mine: template.mine ?? true,
          }))}
          selectedId={selected?.templateId ?? null}
          canShare={account.role === 'admin'}
          panel={selected ? <TemplatePanel key={selected.templateId} template={selected} /> : null}
        />
      ) : (
        <EmptyState icon={TemplateIcon} title={t('emptyTitle')}>
          {t('emptyBody')}
        </EmptyState>
      )}

      <section
        id="brandbooks"
        aria-labelledby="brandbooks-title"
        className="flex scroll-mt-6 flex-col gap-6 border-t border-border pt-8"
      >
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="brandbooks-title" className="text-xl font-semibold tracking-tight">
              {tb('title')}
            </h2>
            <p className="max-w-xl text-sm text-muted-foreground">{tb('subtitle')}</p>
          </div>
          <BrandbookUpload className="w-full shrink-0 sm:w-auto" />
        </header>
        {brandbooks.length > 0 ? (
          <BrandbookLibrary
            brandbooks={brandbooks}
            selectedId={selectedBrandbook?.brandbookId ?? null}
            canShare={account.role === 'admin'}
            panel={
              selectedBrandbook ? (
                <BrandbookPanel key={selectedBrandbook.brandbookId} brandbook={selectedBrandbook} />
              ) : null
            }
          />
        ) : (
          <EmptyState icon={PaletteIcon} title={tb('emptyTitle')}>
            {tb('emptyBody')}
          </EmptyState>
        )}
      </section>
    </LibraryPage>
  );
}
