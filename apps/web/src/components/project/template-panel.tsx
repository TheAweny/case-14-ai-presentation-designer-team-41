import type { CSSProperties } from 'react';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { DesignSystem, TypeStyle } from '@lct/contracts';
import { SlideView, lineHeightOf } from '@lct/slide-renderer';
import { useEmptyTextPrompt } from '@/components/editor/empty-text';
import { FontSample } from '@/components/library/project-card';
import { fontStackOf, roleColor } from '@/components/library/template-swatch';
import type { SlideLayout } from '@/lib/deck-source';
import type { TemplateSummary } from '@/lib/library-source';

/**
 * Вкладка «Шаблон»: что извлечено из файла при импорте — профиль (палитра по ролям, шрифты,
 * пропорции), шкала типографики и макеты. Показывается ровно то, что есть в профиле: роли,
 * которых у шаблона нет, не рисуются, и ни одно значение не задано в коде.
 */
export async function TemplatePanel({ template }: { template: TemplateSummary }) {
  const t = await getTranslations('projectPage.template');
  return (
    <div className="flex flex-col gap-8">
      <TemplateProfile template={template} />

      <section aria-labelledby="template-type-scale" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="template-type-scale" className="text-base font-semibold">
            {t('typeScale')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('typeScaleHint')}</p>
        </div>
        <TypeScale system={template.designSystem} />
      </section>

      <section aria-labelledby="template-layouts" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="template-layouts" className="flex items-baseline gap-2 text-base font-semibold">
            {t('gallery')}
            <span className="text-sm font-normal text-muted-foreground tabular-nums">
              {template.layouts.length}
            </span>
          </h2>
          <p className="text-sm text-muted-foreground">{t('galleryHint')}</p>
        </div>
        <LayoutGallery layouts={template.layouts} system={template.designSystem} />
      </section>
    </div>
  );
}

/** Файл, дата импорта, пропорции, число макетов, палитра по ролям и шрифты. */
async function TemplateProfile({ template }: { template: TemplateSummary }) {
  const [t, format] = await Promise.all([getTranslations('projectPage'), getFormatter()]);
  const { designSystem } = template;
  const imported = new Date(template.importedAt);

  return (
    <section
      aria-labelledby="template-profile"
      className="grid gap-6 rounded-lg bg-card p-4 ring-1 ring-border md:p-5 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]"
    >
      <div className="flex min-w-0 flex-col gap-4">
        <h2 id="template-profile" className="text-base font-semibold">
          {t('template.heading')}
        </h2>
        <div className="flex min-w-0 items-center gap-3">
          <FontSample system={designSystem} className="size-16 text-2xl" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm font-medium break-all">{template.fileName}</p>
            <p className="text-xs text-muted-foreground">
              <time dateTime={imported.toISOString()}>
                {t('template.imported', {
                  date: format.dateTime(imported, { dateStyle: 'long' }),
                })}
              </time>
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">{t('template.aspect')}</dt>
          <dd className="tabular-nums">{designSystem.aspect}</dd>
          <dt className="text-muted-foreground">{t('template.layouts')}</dt>
          <dd className="tabular-nums">{template.layouts.length}</dd>
        </dl>
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('template.palette')}
          </h3>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,9rem),1fr))] gap-2">
            {designSystem.palette.map((entry) => (
              <li
                key={entry.role}
                className="flex min-w-0 items-center gap-2.5 rounded-md p-1.5 ring-1 ring-border"
              >
                <span
                  aria-hidden
                  className="size-8 shrink-0 rounded ring-1 ring-foreground/15"
                  style={{ backgroundColor: `#${entry.hex}` }}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-xs font-medium">{t(`roles.${entry.role}`)}</span>
                  <span className="font-mono text-[0.6875rem] text-muted-foreground uppercase">
                    #{entry.hex}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('template.fonts')}
          </h3>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1.5">
            {designSystem.typeFamilies.map((family) => (
              <div key={family.role} className="contents">
                <dt className="text-xs text-muted-foreground">{t(`fontRoles.${family.role}`)}</dt>
                <dd className="truncate text-base" style={{ fontFamily: fontStackOf(family.font) }}>
                  {family.font}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

/** Во сколько раз образец меньше кегля: 1 pt слайда — 0,75 px на экране. */
const SAMPLE_SCALE = 0.75;
/** Мельче этого образец не читается, поэтому мелкие кегли дотягиваются до него. */
const SAMPLE_MIN_PX = 11;

/**
 * Как выглядит текст роли на слайде: шрифт, кегль, начертание и цвет роли на фоне шаблона.
 * Текст «на акценте» стоит на акценте — на фоне слайда его было бы не видно.
 */
function sampleStyle(system: DesignSystem, style: TypeStyle): CSSProperties {
  const onAccent = style.colorRole === 'text-on-accent';
  return {
    fontFamily: fontStackOf(style.font),
    fontSize: `${Math.max(SAMPLE_MIN_PX, style.sizePt * SAMPLE_SCALE)}px`,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    lineHeight: lineHeightOf(style.lineSpacing),
    color: roleColor(system, style.colorRole) ?? undefined,
    backgroundColor: roleColor(system, onAccent ? 'accent' : 'background') ?? undefined,
  };
}

/** Шкала типографики: роли от крупной к мелкой, образец и параметры каждой. */
async function TypeScale({ system }: { system: DesignSystem }) {
  const t = await getTranslations('projectPage');
  // Сортировка устойчивая: роли одного кегля остаются в порядке профиля.
  const scale = [...system.typeScale].sort((a, b) => b.sizePt - a.sizePt);

  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg ring-1 ring-border">
      {scale.map((style) => {
        const weight = style.bold ? t('template.bold') : t('template.regular');
        return (
          <li
            key={style.role}
            className="grid min-w-0 gap-x-4 gap-y-1.5 px-3 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)_12rem] sm:items-center"
          >
            <span className="text-xs text-muted-foreground">{t(`typeRoles.${style.role}`)}</span>
            <span
              className="min-w-0 truncate rounded-md px-2.5 py-1.5 ring-1 ring-foreground/10"
              style={sampleStyle(system, style)}
            >
              {t(`typeSamples.${style.role}`)}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums sm:text-right">
              {t('template.size', { size: style.sizePt })} · {weight}
              {style.italic ? `, ${t('template.italic')}` : null} · {style.font}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Макеты шаблона миниатюрами, в порядке файла. Миниатюра скрыта от чтения с экрана: макет
 * называет подпись. В пустых рамках — подсказки, как в меню нового слайда редактора.
 */
function LayoutGallery({
  layouts,
  system,
}: {
  layouts: readonly SlideLayout[];
  system: DesignSystem;
}) {
  const emptyText = useEmptyTextPrompt();
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,12rem),1fr))] gap-x-4 gap-y-4">
      {layouts.map((layout) => (
        <li key={layout.slide.patternId} className="min-w-0">
          <figure className="flex min-w-0 flex-col gap-1.5">
            <div
              aria-hidden
              className="overflow-hidden rounded-md bg-card ring-1 ring-border"
              style={{ aspectRatio: `${layout.slide.slideCx} / ${layout.slide.slideCy}` }}
            >
              <SlideView slide={layout.slide} profile={system} emptyText={emptyText} thumbnail />
            </div>
            <figcaption className="truncate px-0.5 text-xs text-muted-foreground">
              {layout.name}
            </figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );
}
