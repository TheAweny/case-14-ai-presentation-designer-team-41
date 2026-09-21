'use client';

import { useRef, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { RailGrip, ToolRail, type ToolId, type VariantId } from '@/components/editor/tool-rail';
import { useDock } from '@/components/editor/use-dock';
import {
  DOCK_SIDES,
  dockAxis,
  dockZonePoint,
  railSize,
  railSpan,
  type DockSide,
  type RailSpan,
  type Size,
} from '@/components/editor/dock';

const ZONE_FADE = { duration: 0.18, ease: 'easeOut' } as const;
const INSTANT = { duration: 0 } as const;

/** Стрелки на ручке переносят панель в зону, минуя мышь. */
const ARROW_TO_SIDE: Record<string, DockSide> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'top',
  ArrowDown: 'bottom',
};

/**
 * Готовые зоны, пока панель тащат: видно все четыре, а та, что поймает панель, подсвечена.
 * Каждый след нарисован в той ориентации, в которой панель в этой зоне встанет.
 */
function DockZones({ area, span, snap }: { area: Size; span: RailSpan; snap: DockSide | null }) {
  const reduceMotion = useReducedMotion() === true;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
      {DOCK_SIDES.map((side) => {
        const size = railSize(span, dockAxis(side));
        const point = dockZonePoint(side, area, size);
        const active = side === snap;
        return (
          <motion.div
            key={side}
            className={cn(
              'absolute top-0 left-0 rounded-full border border-dashed',
              active ? 'border-primary/70 bg-primary/10' : 'border-border bg-card/20',
            )}
            style={{ width: size.width, height: size.height, x: point.x, y: point.y }}
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: active ? 1 : 0.6, scale: active ? 1 : 0.97 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={reduceMotion ? INSTANT : ZONE_FADE}
          />
        );
      })}
    </div>
  );
}

/**
 * Область, внутри которой живёт панель инструментов. Панель лежит поверх содержимого: её
 * можно поставить в любое место области и примагнитить к одной из четырёх зон — к середине
 * любого края. Выбранное место запоминается между сессиями.
 *
 * Разметка области своя у вызывающего: панель получает её фактические размеры измерением,
 * поэтому зоны не завязаны ни на какие константы вёрстки.
 */
export function ToolRailDock({
  className,
  railClassName,
  hiddenTools,
  onSelect,
  children,
}: {
  className?: string;
  /** Класс самой панели: например, скрыть её там, где области ещё мало. */
  railClassName?: string;
  hiddenTools?: readonly ToolId[];
  onSelect?: (id: VariantId) => void;
  children?: ReactNode;
}) {
  const t = useTranslations('toolRail');
  const areaRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const dock = useDock({ areaRef, railRef });
  const axis = dockAxis(dock.side);
  const span = railSpan(dock.rail, axis);

  return (
    <div ref={areaRef} className={cn('relative', dock.dragging && 'cursor-grabbing', className)}>
      {children}

      <AnimatePresence>
        {dock.dragging && <DockZones key="zones" area={dock.area} span={span} snap={dock.snap} />}
      </AnimatePresence>

      <motion.div
        ref={railRef}
        // Позиция всегда абсолютная: и в зоне, и в свободном положении её держит один и тот
        // же сдвиг, поэтому переход между ними — обычная анимация, а не смена вёрстки.
        className="absolute top-0 left-0 z-20"
        style={{ x: dock.x, y: dock.y }}
        animate={{ opacity: dock.ready ? 1 : 0 }}
        transition={ZONE_FADE}
      >
        <ToolRail
          side={dock.side}
          frozen={dock.dragging}
          hiddenTools={hiddenTools}
          onSelect={onSelect}
          className={cn(railClassName, dock.dragging && 'shadow-xl shadow-black/30')}
          grip={
            <RailGrip
              axis={axis}
              dragging={dock.dragging}
              title={t('gripHint')}
              onKeyDown={(event) => {
                const side = ARROW_TO_SIDE[event.key];
                if (!side) return;
                event.preventDefault();
                dock.moveTo(side);
              }}
              {...dock.grip}
            />
          }
        />
      </motion.div>
    </div>
  );
}
