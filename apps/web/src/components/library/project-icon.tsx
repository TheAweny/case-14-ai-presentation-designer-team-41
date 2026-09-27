import type { CSSProperties } from 'react';
import {
  BookIcon,
  BriefcaseIcon,
  CodeIcon,
  FlagIcon,
  FolderIcon,
  GlobeIcon,
  GraduationIcon,
  GrowthIcon,
  HeartIcon,
  IdeaIcon,
  LeafIcon,
  MegaphoneIcon,
  MoneyIcon,
  PaletteIcon,
  PeopleIcon,
  RocketIcon,
  ShieldIcon,
  StarIcon,
  TargetIcon,
  TrophyIcon,
  type Icon,
} from '@/components/ui/icons';
import {
  projectColorVar,
  type ProjectAppearance,
  type ProjectIconId,
} from '@/lib/project-appearance';
import { cn } from '@/lib/utils';

/** Картинка за каждой иконкой проекта. `satisfies` не даст забыть новую иконку набора. */
export const PROJECT_ICONS = {
  folder: FolderIcon,
  chart: GrowthIcon,
  rocket: RocketIcon,
  briefcase: BriefcaseIcon,
  idea: IdeaIcon,
  target: TargetIcon,
  globe: GlobeIcon,
  book: BookIcon,
  graduation: GraduationIcon,
  star: StarIcon,
  flag: FlagIcon,
  megaphone: MegaphoneIcon,
  shield: ShieldIcon,
  heart: HeartIcon,
  code: CodeIcon,
  trophy: TrophyIcon,
  money: MoneyIcon,
  people: PeopleIcon,
  palette: PaletteIcon,
  leaf: LeafIcon,
} as const satisfies Record<ProjectIconId, Icon>;

const SIZES = {
  sm: { box: 'size-5 rounded-[5px]', icon: 16 },
  md: { box: 'size-8 rounded-md', icon: 20 },
  lg: { box: 'size-12 rounded-xl', icon: 30 },
} as const;

export type ProjectIconSize = keyof typeof SIZES;

/**
 * Цвет иконки проекта. Подложки нет: перекрашивается сама иконка. Отдельно от компонента,
 * чтобы кнопки выбора красились так же.
 */
export function projectTint(color: ProjectAppearance['color']): CSSProperties {
  return { color: projectColorVar(color) };
}

/**
 * Иконка проекта в его цвете. Декоративная: проект всегда назван рядом текстом, поэтому для
 * чтения с экрана иконка скрыта.
 */
export function ProjectIcon({
  appearance,
  size = 'md',
  className,
}: {
  appearance: ProjectAppearance;
  size?: ProjectIconSize;
  className?: string;
}) {
  const look = SIZES[size];
  const Glyph = PROJECT_ICONS[appearance.icon];
  return (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center', look.box, className)}
      style={projectTint(appearance.color)}
    >
      <Glyph size={look.icon} />
    </span>
  );
}
