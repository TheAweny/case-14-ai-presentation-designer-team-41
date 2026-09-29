import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { TemplateIcon } from '@/components/ui/icons';
import { EmptyState, LibraryPage } from '@/components/library/page-parts';
import { TemplatePanel } from '@/components/project/template-panel';
import { templateThumbOf } from '@/components/project/template-thumb';
import { TemplateLibrary, TemplateUpload } from '@/components/templates/template-library';
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
 */
export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string | string[] }>;
}) {
  const [t, account, templates, params] = await Promise.all([
    getTranslations('templatesPage'),
    requireAccount(),
    librarySource.listTemplates(),
    searchParams,
  ]);
  const requested = typeof params.template === 'string' ? params.template : null;
  const selected = templates.find((template) => template.templateId === requested) ?? null;

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
    </LibraryPage>
  );
}
