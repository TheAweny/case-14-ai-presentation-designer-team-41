import Link from 'next/link';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import type { DesignSystem } from '@lct/contracts';
import {
  fontStackOf,
  PaletteStrip,
  primaryFontOf,
  roleColor,
} from '@/components/library/template-swatch';
import {
  ProjectActions,
  ProjectLook,
  ProjectName,
  ProjectPinMark,
} from '@/components/library/project-actions';
import { projectHref } from '@/lib/library-menu';
import type { ProjectSummary } from '@/lib/library-source';
import { cn } from '@/lib/utils';

/**
 * Карточка проекта: стиль шаблона с одного взгляда — полоса палитры и образец основного шрифта
 * в цветах самого шаблона, — иконка и имя проекта, файл шаблона, сколько в нём презентаций и когда его
 * трогали. Всё оформление образца берётся из профиля, код не знает ни одного цвета шаблона.
 * Правая кнопка и «⋯» в углу открывают меню проекта (`ProjectActions`).
 */
export function ProjectCard({ project }: { project: ProjectSummary }) {
  const t = useTranslations('home.projectCard');
  const format = useFormatter();
  const now = useNow();
  // Образец стиля — по первому шаблону проекта; шаблонов нет — образец в цветах интерфейса.
  const [template] = project.templates;
  const edited = new Date(project.updatedAt);

  return (
    <ProjectActions
      project={{
        projectId: project.projectId,
        name: project.name,
        appearance: project.appearance,
        deckCount: project.deckCount,
        pinned: project.pinned,
      }}
      rename="dialog"
      buttonClassName="right-2 bottom-2"
    >
      <Link
        href={projectHref(project.projectId)}
        className={cn(
          'group/project flex min-w-0 flex-col gap-3 rounded-lg bg-card p-3 ring-1 ring-border outline-none',
          'transition-[box-shadow,background-color] duration-150 motion-reduce:transition-none',
          'hover:ring-foreground/30 focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          {template?.previewDataUrl ? (
            <img
              src={template.previewDataUrl}
              alt=""
              aria-hidden
              className="size-12 rounded-md object-cover ring-1 ring-border"
            />
          ) : (
            <FontSample system={template?.designSystem} className="size-12 text-xl" />
          )}
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
              <ProjectLook appearance={project.appearance} size="sm" />
              <span className="truncate">
                <ProjectName>{project.name}</ProjectName>
              </span>
              <ProjectPinMark pinned={project.pinned} />
            </h3>
            {template ? (
              <p className="truncate text-xs text-muted-foreground">{template.fileName}</p>
            ) : null}
          </div>
        </div>

        {template ? (
          <PaletteStrip system={template.designSystem} className="h-2" />
        ) : (
          <span aria-hidden className="h-2 rounded-full bg-muted" />
        )}

        {/* «⋯» стоит в углу у этой строки, а не у имени: имени достаётся вся ширина. */}
        <p className="flex min-w-0 items-center gap-1.5 pr-8 text-xs text-muted-foreground">
          <span className="shrink-0 tabular-nums">{t('decks', { count: project.deckCount })}</span>
          <span aria-hidden>·</span>
          <time dateTime={edited.toISOString()} className="min-w-0 truncate">
            {t('edited', { time: format.relativeTime(edited, now) })}
          </time>
        </p>
      </Link>
    </ProjectActions>
  );
}

/**
 * «Aa» основным шрифтом шаблона на его фоне и его цветом текста. Ролей в профиле нет — образец
 * остаётся в цветах интерфейса.
 */
export function FontSample({
  system,
  className,
}: {
  /** Профиль шаблона; без него образец — в шрифте и цветах интерфейса. */
  system: DesignSystem | undefined;
  className?: string;
}) {
  const font = system ? primaryFontOf(system) : undefined;
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-md bg-muted leading-none font-semibold ring-1 ring-border',
        className,
      )}
      style={{
        fontFamily: font ? fontStackOf(font) : undefined,
        backgroundColor: (system && roleColor(system, 'background')) ?? undefined,
        color: (system && roleColor(system, 'text')) ?? undefined,
      }}
    >
      Aa
    </span>
  );
}
