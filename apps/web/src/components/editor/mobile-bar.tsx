'use client';

import { Fragment, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';
import {
  CloseIcon,
  PlayIcon,
  PlusIcon,
  PropertiesIcon,
  RedoIcon,
  UndoIcon,
  type Icon,
} from '@/components/ui/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { keepCanvasFocus } from '@/components/editor/chrome-focus';
import { isInsertTool } from '@/components/editor/insert-element';
import { INSERT_GROUPS, type RailHistory, type VariantId } from '@/components/editor/tool-rail';

/** Цель пальца — не меньше 44 px (WCAG 2.5.5, рекомендации Apple и Material). */
const TOUCH = cn(
  'grid size-11 shrink-0 place-items-center rounded-xl outline-none',
  'text-muted-foreground transition-colors duration-100 motion-reduce:transition-none',
  'hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
  'active:bg-muted disabled:pointer-events-none disabled:opacity-35',
);

/**
 * Нижняя панель узкого экрана, как в мобильных Google Slides и Canva: рейки и правой панели
 * там нет, а отменить правку, вставить объект и открыть свойства нужно и с телефона.
 *
 * Вставка — те же инструменты, что на рейке: выбранный ждёт касания слайда, и объект встаёт
 * туда, где коснулись. Пока инструмент ждёт, над панелью висит подсказка с отменой.
 */
export function MobileBar({
  history,
  tool,
  onToolChange,
  onPresent,
  onProperties,
  className,
}: {
  history: RailHistory;
  tool: VariantId;
  onToolChange: (tool: VariantId) => void;
  onPresent: () => void;
  onProperties: () => void;
  className?: string;
}) {
  const t = useTranslations('mobileBar');
  const rail = useTranslations('toolRail');
  const armed = isInsertTool(tool) ? tool : null;
  const historyLabel = (id: 'undo' | 'redo') =>
    rail(`history.${id}`, { change: rail(`history.changes.${history[id] ?? 'other'}`) });

  return (
    <div data-mobile-bar="" className={cn('relative shrink-0', className)}>
      {armed ? (
        <div
          role="status"
          className={cn(
            'absolute inset-x-0 bottom-full flex justify-center p-2',
            'pointer-events-none',
          )}
        >
          <div
            className={cn(
              'pointer-events-auto flex items-center gap-1 rounded-full bg-popover py-0.5 pr-0.5 pl-3',
              'text-xs text-popover-foreground shadow-lg ring-1 shadow-black/20 ring-border',
            )}
          >
            {t('insertHint', { tool: rail(`variants.${armed}`) })}
            <button
              type="button"
              aria-label={t('cancelInsert')}
              onMouseDown={keepCanvasFocus}
              onClick={() => onToolChange('select')}
              className={cn(TOUCH, 'size-9 rounded-full')}
            >
              <CloseIcon size={14} className="[--icon-stroke:1.5]" />
            </button>
          </div>
        </div>
      ) : null}
      <div
        role="toolbar"
        aria-label={t('label')}
        className={cn(
          'flex items-center justify-around gap-1 border-t border-border bg-sidebar px-2 pt-1',
          'pb-[max(0.25rem,env(safe-area-inset-bottom))]',
        )}
      >
        <BarButton
          label={historyLabel('undo')}
          icon={UndoIcon}
          disabled={history.undo === null}
          onClick={history.onUndo}
        />
        <BarButton
          label={historyLabel('redo')}
          icon={RedoIcon}
          disabled={history.redo === null}
          onClick={history.onRedo}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('insert')}
              onMouseDown={keepCanvasFocus}
              className={cn(
                TOUCH,
                armed && 'bg-primary text-primary-foreground hover:bg-primary/90',
              )}
            >
              <PlusIcon size={20} className="[--icon-stroke:1.5]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="center"
            sideOffset={8}
            className="z-[4000] w-auto min-w-52"
          >
            {INSERT_GROUPS.map((group, index) => (
              <Fragment key={group[0]?.id ?? index}>
                {index > 0 ? <DropdownMenuSeparator /> : null}
                {group.map((variant) => (
                  <DropdownMenuItem
                    key={variant.id}
                    onSelect={() => onToolChange(variant.id)}
                    className="min-h-11"
                  >
                    <variant.icon size={16} className="[--icon-stroke:1.5]" />
                    {rail(`variants.${variant.id}`)}
                  </DropdownMenuItem>
                ))}
              </Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <BarButton label={rail('tools.present')} icon={PlayIcon} onClick={onPresent} />
        <BarButton label={t('properties')} icon={PropertiesIcon} onClick={onProperties} />
      </div>
    </div>
  );
}

function BarButton({
  label,
  icon: ButtonIcon,
  disabled,
  onClick,
}: {
  label: string;
  icon: Icon;
  disabled?: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseDown={keepCanvasFocus}
      onClick={onClick}
      className={TOUCH}
    >
      <ButtonIcon size={20} className="[--icon-stroke:1.5]" />
    </button>
  );
}
