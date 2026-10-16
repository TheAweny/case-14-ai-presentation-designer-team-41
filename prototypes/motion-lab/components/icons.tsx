import type { ComponentType, ReactNode } from 'react';
import {
  IconChevronDown,
  IconPaperclip,
  IconCalendar,
  IconX,
  IconChartLine,
  IconFile,
  IconWorld,
  IconHelpCircle,
  IconMail,
  IconMicrophone,
  IconPlus,
  IconSparkles,
  IconCheck,
  type IconProps,
} from '@tabler/icons-react';

// Local adapter keeps the reference components on the icon set already installed in this repo.
export type IconSvgElement = ComponentType<IconProps>;
export function HugeiconsIcon({
  icon: Icon,
  size,
  strokeWidth,
}: {
  icon: IconSvgElement;
  size?: number | string;
  strokeWidth?: number;
}): ReactNode {
  return <Icon size={size} stroke={strokeWidth} aria-hidden />;
}
export {
  IconChevronDown as ArrowDown01Icon,
  IconPaperclip as Attachment01Icon,
  IconCalendar as Calendar03Icon,
  IconX as Cancel01Icon,
  IconChartLine as ChartLineData01Icon,
  IconFile as File02Icon,
  IconWorld as Globe02Icon,
  IconHelpCircle as HelpCircleIcon,
  IconMail as Mail01Icon,
  IconMicrophone as Mic01Icon,
  IconPlus as PlusSignIcon,
  IconSparkles as SparklesIcon,
  IconCheck as Tick02Icon,
};
