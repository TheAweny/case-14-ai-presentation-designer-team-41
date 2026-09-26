import type { ColorRole, DesignSystem } from '@lct/contracts';
import { cn } from '@/lib/utils';

/** Цвет роли из профиля шаблона в виде CSS; роли нет — null. */
export function roleColor(system: DesignSystem, role: ColorRole): string | null {
  const entry = system.palette.find((item) => item.role === role);
  return entry ? `#${entry.hex}` : null;
}

/** Акцент шаблона, а без него — первый цвет палитры: палитра в профиле не бывает пустой. */
export function accentOf(system: DesignSystem): string {
  return roleColor(system, 'accent') ?? `#${system.palette[0]?.hex ?? '888888'}`;
}

/** Основной шрифт шаблона, как его назвал профиль. */
export function primaryFontOf(system: DesignSystem): string | null {
  const family =
    system.typeFamilies.find((item) => item.role === 'primary') ?? system.typeFamilies[0];
  return family?.font ?? null;
}

/**
 * Полоска цветов шаблона: палитра профиля по порядку. Показывает стиль шаблона без
 * миниатюры — в карточке проекта, в сайдбаре, в выборе шаблона.
 */
export function PaletteStrip({
  system,
  className,
  max = 6,
}: {
  system: DesignSystem;
  className?: string;
  /** Сколько цветов показать. */
  max?: number;
}) {
  return (
    <span aria-hidden className={cn('flex h-3 overflow-hidden rounded-full', className)}>
      {system.palette.slice(0, max).map((entry) => (
        <span key={entry.role} className="flex-1" style={{ backgroundColor: `#${entry.hex}` }} />
      ))}
    </span>
  );
}

/**
 * Шрифт шаблона как значение `font-family`: имя в кавычках и общий запасной вариант, чтобы
 * образец не падал в засечки браузера, когда шрифта шаблона на машине нет.
 */
export function fontStackOf(font: string): string {
  return `"${font.replace(/["\\]/g, '')}", sans-serif`;
}
