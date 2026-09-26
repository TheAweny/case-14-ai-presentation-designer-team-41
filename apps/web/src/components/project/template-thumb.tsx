import type { DesignSystem, SlideIr } from '@lct/contracts';
import { SlideView } from '@lct/slide-renderer';
import { useEmptyTextPrompt } from '@/components/editor/empty-text';
import { FontSample } from '@/components/library/project-card';
import type { TemplateSummary } from '@/lib/library-source';
import { cn } from '@/lib/utils';

/**
 * Шаблон так, как его показывает карточка: имя файла, сколько макетов, профиль и титульный
 * макет. Собирается на сервере из `TemplateSummary`: клиенту незачем получать все макеты
 * каждого шаблона, чтобы нарисовать одну миниатюру.
 */
export interface TemplateThumb {
  readonly templateId: string;
  readonly fileName: string;
  readonly layoutCount: number;
  readonly designSystem: DesignSystem;
  /** Титульный макет — первый в файле, как в PowerPoint; макетов нет — null. */
  readonly cover: SlideIr | null;
}

export function templateThumbOf(template: TemplateSummary): TemplateThumb {
  return {
    templateId: template.templateId,
    fileName: template.fileName,
    layoutCount: template.layouts.length,
    designSystem: template.designSystem,
    cover: template.layouts[0]?.slide ?? null,
  };
}

/**
 * Миниатюра шаблона: титульный макет, нарисованный профилем шаблона, с подсказками в пустых
 * рамках — так видно, что это макет, а не пустой слайд. Макетов нет — образец шрифта в цветах
 * шаблона. Скрыта от чтения с экрана: шаблон называет подпись карточки.
 */
export function TemplateCover({
  template,
  className,
}: {
  template: Pick<TemplateThumb, 'cover' | 'designSystem'>;
  className?: string;
}) {
  const emptyText = useEmptyTextPrompt();
  const { cover, designSystem } = template;
  return (
    <div
      aria-hidden
      className={cn('overflow-hidden rounded-md bg-card ring-1 ring-border', className)}
      style={{
        aspectRatio: cover
          ? `${cover.slideCx} / ${cover.slideCy}`
          : designSystem.aspect.replace(':', ' / '),
      }}
    >
      {cover ? (
        <SlideView slide={cover} profile={designSystem} emptyText={emptyText} thumbnail />
      ) : (
        <FontSample system={designSystem} className="size-full rounded-none text-2xl ring-0" />
      )}
    </div>
  );
}
