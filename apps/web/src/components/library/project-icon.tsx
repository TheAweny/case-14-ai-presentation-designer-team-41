import type { CSSProperties } from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  Book02Icon,
  Briefcase01Icon,
  ChampionIcon,
  ChartLineData01Icon,
  Coins01Icon,
  FavouriteIcon,
  Flag02Icon,
  Folder01Icon,
  GlobalIcon,
  GraduationCapIcon,
  Idea01Icon,
  Leaf01Icon,
  Megaphone02Icon,
  PaintBoardIcon,
  Rocket01Icon,
  Shield01Icon,
  SourceCodeIcon,
  StarIcon,
  Target02Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons';
import {
  projectColorVar,
  type ProjectAppearance,
  type ProjectIconId,
} from '@/lib/project-appearance';
import { cn } from '@/lib/utils';

/** Картинка за каждой иконкой проекта. `satisfies` не даст забыть новую иконку набора. */
export const PROJECT_ICONS = {
  folder: Folder01Icon,
  chart: ChartLineData01Icon,
  rocket: Rocket01Icon,
  briefcase: Briefcase01Icon,
  idea: Idea01Icon,
  target: Target02Icon,
  globe: GlobalIcon,
  book: Book02Icon,
  graduation: GraduationCapIcon,
  star: StarIcon,
  flag: Flag02Icon,
  megaphone: Megaphone02Icon,
  shield: Shield01Icon,
  heart: FavouriteIcon,
  code: SourceCodeIcon,
  trophy: ChampionIcon,
  money: Coins01Icon,
  people: UserGroupIcon,
  palette: PaintBoardIcon,
  leaf: Leaf01Icon,
} as const satisfies Record<ProjectIconId, IconSvgElement>;

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
  return (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center', look.box, className)}
      style={projectTint(appearance.color)}
    >
      <HugeiconsIcon icon={PROJECT_ICONS[appearance.icon]} size={look.icon} strokeWidth={1.75} />
    </span>
  );
}
