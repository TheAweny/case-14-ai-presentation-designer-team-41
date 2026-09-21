'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Moveable from 'react-moveable';
import Selecto from 'react-selecto';
import type { Box, Grid, SlideIr } from '@lct/contracts';
import { boxStyle } from '@lct/slide-renderer';
import {
  clampToMargins,
  fitsInMargins,
  gridGuidelines,
  pixelBoxToEmu,
} from '@/components/editor/slide-geometry';
import type { ElementMove } from '@/components/editor/use-deck-history';

/**
 * Put the measured box back as percentages. Clearing width and height leaves them empty:
 * React only rewrites the properties that changed, so an empty shape with the same size
 * collapses to nothing.
 */
function placeBox(target: HTMLElement, box: Box, slide: SlideIr) {
  const style = boxStyle(box, { cx: slide.slideCx, cy: slide.slideCy });
  target.style.transform = '';
  target.style.left = String(style.left);
  target.style.top = String(style.top);
  target.style.width = String(style.width);
  target.style.height = String(style.height);
}

function readMoves(
  targets: readonly (HTMLElement | SVGElement)[],
  host: HTMLElement,
  slide: SlideIr,
  grid: Grid,
) {
  const hostRect = host.getBoundingClientRect();
  const moves: ElementMove[] = [];
  for (const target of targets) {
    if (!(target instanceof HTMLElement)) continue;
    const elementId = target.dataset.elementId;
    if (!elementId) continue;
    const rect = target.getBoundingClientRect();
    moves.push({
      elementId,
      box: clampToMargins(
        pixelBoxToEmu(
          {
            x: rect.left - hostRect.left,
            y: rect.top - hostRect.top,
            width: rect.width,
            height: rect.height,
          },
          { width: hostRect.width, height: hostRect.height },
          slide.slideCx,
          slide.slideCy,
        ),
        grid,
      ),
    });
  }
  return moves;
}

function holdRatio(event: {
  inputEvent?: { shiftKey?: boolean };
  target: HTMLElement | SVGElement;
  setRatio: (ratio: number) => void;
}) {
  if (!event.inputEvent?.shiftKey || !(event.target instanceof HTMLElement)) return;
  const { offsetWidth, offsetHeight } = event.target;
  if (offsetWidth > 0 && offsetHeight > 0) event.setRatio(offsetWidth / offsetHeight);
}

/**
 * Ручки и рамка выделения поверх уже нарисованного слайда. Жест доходит до журнала один раз,
 * в конце: пиксели кадра переводятся в EMU.
 */
export function SlideHandles({
  host,
  slide,
  grid,
  selectedIds,
  onSelect,
  onCommit,
}: {
  host: HTMLElement;
  slide: SlideIr;
  grid: Grid;
  selectedIds: readonly string[];
  onSelect: (ids: readonly string[]) => void;
  onCommit: (moves: readonly ElementMove[]) => void;
}) {
  const moveableRef = useRef<Moveable>(null);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [shift, setShift] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') setShift(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') setShift(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);
  const selected = new Set(selectedIds);

  useLayoutEffect(() => {
    const measure = () => setFrame({ width: host.clientWidth, height: host.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [host]);

  useLayoutEffect(() => {
    moveableRef.current?.updateRect();
  }, [slide, selectedIds, frame]);

  const targets = selectedIds.flatMap((id) => {
    const element = host.querySelector<HTMLElement>(`[data-element-id="${CSS.escape(id)}"]`);
    return element ? [element] : [];
  });
  const neighbors = [...host.querySelectorAll<HTMLElement>('[data-element-id]')].filter(
    (element) => !selected.has(element.dataset.elementId ?? ''),
  );
  const guides = gridGuidelines(grid, frame);
  const insideMargins = selectedIds.every((id) => {
    const element = slide.elements.find((item) => item.elementId === id);
    return element ? fitsInMargins(element.box, grid) : true;
  });
  const bounds = insideMargins
    ? {
        position: 'css' as const,
        left: (grid.marginLeft / grid.slideCx) * frame.width,
        top: (grid.marginTop / grid.slideCy) * frame.height,
        right: (grid.marginRight / grid.slideCx) * frame.width,
        bottom: (grid.marginBottom / grid.slideCy) * frame.height,
      }
    : { position: 'css' as const, left: 0, top: 0, right: 0, bottom: 0 };

  const commit = (nodes: readonly (HTMLElement | SVGElement)[]) => {
    const moves = readMoves(nodes, host, slide, grid);
    const byId = new Map(moves.map((move) => [move.elementId, move.box]));
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) continue;
      const box = node.dataset.elementId ? byId.get(node.dataset.elementId) : undefined;
      if (box) placeBox(node, box, slide);
      else node.style.transform = '';
    }
    flushSync(() => onCommit(moves));
  };

  return (
    <>
      {targets.length > 0 ? (
        <Moveable
          ref={moveableRef}
          target={targets}
          flushSync={flushSync}
          container={host}
          rootContainer={host}
          draggable
          resizable
          rotatable={false}
          origin={false}
          keepRatio={shift}
          snappable
          snapThreshold={5}
          isDisplaySnapDigit={false}
          elementGuidelines={neighbors}
          verticalGuidelines={guides.vertical}
          horizontalGuidelines={guides.horizontal}
          bounds={frame.width > 0 ? bounds : null}
          onDrag={({ target, transform }) => {
            target.style.transform = transform;
          }}
          onDragEnd={(event) => {
            if (!event.isDrag) return;
            commit([event.target]);
          }}
          onDragGroup={({ events }) => {
            for (const event of events) event.target.style.transform = event.transform;
          }}
          onDragGroupEnd={(event) => {
            if (!event.isDrag) return;
            commit(event.targets);
          }}
          onResizeStart={holdRatio}
          onResize={({ target, width, height, drag }) => {
            target.style.width = `${width}px`;
            target.style.height = `${height}px`;
            target.style.transform = drag.transform;
          }}
          onResizeEnd={(event) => {
            if (!event.isDrag) return;
            commit([event.target]);
          }}
          onResizeGroupStart={({ events, inputEvent }) => {
            if (!(inputEvent as { shiftKey?: boolean } | null)?.shiftKey) return;
            for (const event of events) holdRatio(event);
          }}
          onResizeGroup={({ events }) => {
            for (const event of events) {
              event.target.style.width = `${event.width}px`;
              event.target.style.height = `${event.height}px`;
              event.target.style.transform = event.drag.transform;
            }
          }}
          onResizeGroupEnd={(event) => {
            if (!event.isDrag) return;
            commit(event.targets);
          }}
        />
      ) : null}
      <Selecto
        key={slide.slideId}
        dragContainer={host}
        boundContainer={host}
        selectableTargets={[() => [...host.querySelectorAll<HTMLElement>('[data-element-id]')]]}
        selectByClick
        selectFromInside={false}
        toggleContinueSelect={['shift']}
        hitRate={0}
        onDragStart={(event) => {
          const pointer = event.inputEvent.target;
          if (!(pointer instanceof Element)) return;
          const moveable = moveableRef.current;
          if (moveable?.isMoveableElement(pointer)) {
            event.stop();
            return;
          }
          const hit = pointer.closest('[data-element-id]');
          if (hit && targets.includes(hit as HTMLElement)) event.stop();
        }}
        onSelectEnd={(event) => {
          onSelect(
            event.selected.flatMap((element) => {
              const id = element instanceof HTMLElement ? element.dataset.elementId : undefined;
              return id ? [id] : [];
            }),
          );
        }}
      />
    </>
  );
}
