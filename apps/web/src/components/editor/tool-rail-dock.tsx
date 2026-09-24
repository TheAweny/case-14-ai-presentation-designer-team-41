'use client';

import { useCallback, useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import {
  RailGrip,
  ToolRail,
  type RailActionId,
  type RailHistory,
  type VariantId,
} from '@/components/editor/tool-rail';
import { useDock } from '@/components/editor/use-dock';
import {
  DOCK_SIDES,
  dockAxis,
  dockZoneRect,
  railSpan,
  type DockSide,
  type DockState,
  type RailSpan,
  type Rect,
  type Size,
} from '@/components/editor/dock';

/** Стрелки на ручке переносят панель в зону, минуя мышь. */
const ARROW_TO_SIDE: Record<string, DockSide> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'top',
  ArrowDown: 'bottom',
};

/**
 * Готовые зоны, пока панель тащат: видно все четыре, а та, что поймает панель, подсвечена.
 * Каждый след нарисован в той ориентации, в которой панель в этой зоне встанет, и уже в
 * обход препятствий. Зона ловит панель, когда курсор над её следом, так что след и есть цель.
 */
function DockZones({
  area,
  span,
  snap,
  obstacles,
}: {
  area: Size;
  span: RailSpan;
  snap: DockSide | null;
  obstacles: readonly Rect[];
}) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
      {DOCK_SIDES.map((side) => {
        const zone = dockZoneRect(side, area, span, obstacles);
        const active = side === snap;
        return (
          <div
            key={side}
            className={cn(
              'absolute top-0 left-0 rounded-full border border-dashed',
              'transition-colors duration-100 motion-reduce:transition-none',
              active ? 'border-primary/70 bg-primary/10' : 'border-border bg-card/25',
            )}
            style={{
              width: zone.width,
              height: zone.height,
              transform: `translate3d(${zone.x}px, ${zone.y}px, 0)`,
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * Область, внутри которой живёт панель инструментов. Панель лежит поверх содержимого: её
 * можно поставить в любое место области и примагнитить к одной из четырёх зон — к середине
 * любого края. На элементы с `data-dock-obstacle` панель не встаёт.
 *
 * Сторона панели видна содержимому как `data-dock-side` на области (группа `dock`): холст
 * оставляет под панель поле только с её стороны.
 *
 * Разметка области своя у вызывающего: панель получает её фактические размеры измерением,
 * поэтому зоны не завязаны ни на какие константы вёрстки.
 */
export function ToolRailDock({
  className,
  railClassName,
  dock: initialDock,
  onDockChange,
  tool,
  onToolChange,
  onAction,
  history,
  children,
}: {
  className?: string;
  /** Класс самой панели: например, скрыть её там, где области ещё мало. */
  railClassName?: string;
  /** Сохранённое положение панели. Читается один раз, дальше панель ходит сама. */
  dock: DockState;
  onDockChange?: (dock: DockState) => void;
  tool: VariantId;
  onToolChange: (id: VariantId) => void;
  onAction?: (id: RailActionId) => void;
  history?: RailHistory;
  children?: ReactNode;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const dock = useDock({ areaRef, railRef, initial: initialDock, onChange: onDockChange });
  const axis = dockAxis(dock.side);
  const span = railSpan(dock.rail, axis);

  const { moveTo } = dock;
  const onGripKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      const side = ARROW_TO_SIDE[event.key];
      if (!side) return;
      event.preventDefault();
      moveTo(side);
    },
    [moveTo],
  );

  // Тот же узел, пока панель не развернулась и её не схватили: смена подсветки зоны
  // не должна заново собирать кнопки.
  const grip = useMemo(
    () => (
      <RailGrip axis={axis} dragging={dock.dragging} onKeyDown={onGripKeyDown} {...dock.grip} />
    ),
    [axis, dock.dragging, dock.grip, onGripKeyDown],
  );

  return (
    <div
      ref={areaRef}
      data-dock-side={dock.side}
      className={cn('group/dock relative', dock.dragging && 'cursor-grabbing', className)}
    >
      {children}

      {dock.dragging && (
        <DockZones area={dock.area} span={span} snap={dock.snap} obstacles={dock.obstacles} />
      )}

      <motion.div
        ref={railRef}
        // Позиция всегда абсолютная: и в зоне, и в свободном положении её держит один и тот
        // же сдвиг. Пока панель тащат, сдвиг пишется напрямую, без анимации.
        className={cn(
          'absolute top-0 left-0 z-20 will-change-transform',
          !dock.ready && 'invisible',
        )}
        style={{ x: dock.x, y: dock.y }}
      >
        <ToolRail
          side={dock.side}
          value={tool}
          onChange={onToolChange}
          onAction={onAction}
          history={history}
          className={railClassName}
          grip={grip}
        />
      </motion.div>
    </div>
  );
}
