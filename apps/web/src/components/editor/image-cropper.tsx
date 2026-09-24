'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useTransformEffect } from 'react-zoom-pan-pinch';
import type { Box, ImageCrop, SlideElement } from '@lct/contracts';
import { boxStyle, type SlideSize } from '@lct/slide-renderer';
import { cn } from '@/lib/utils';
import {
  CROP_CORNERS,
  CROP_HANDLES,
  cropResult,
  cropStart,
  moveImage,
  placeRotated,
  resetCrop,
  resizeFrame,
  scaleImage,
  toLocal,
  type CropCorner,
  type CropHandle,
  type CropState,
  type NaturalSize,
  type Rect,
} from '@/components/editor/image-crop';

type ImageElement = Extract<SlideElement, { kind: 'image' }>;

/** Ручки в экранных пикселях: одного размера при любом зуме. */
const HANDLE_PX = 10;
const EDGE_PX = 18;
const CORNER_PX = 9;
/** Самая узкая рамка кадра, в экранных пикселях на момент жеста. */
const MIN_FRAME_PX = 12;
/** Шаг стрелки — доля кадра; с Shift — крупнее. */
const ARROW_STEP = 0.01;
const ARROW_STEP_LARGE = 0.1;
const TOOLBAR_GAP = 10;

type Gesture =
  | { readonly kind: 'move' }
  | { readonly kind: 'frame'; readonly handle: CropHandle }
  | { readonly kind: 'scale'; readonly corner: CropCorner };

const CURSOR: Record<CropHandle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

function naturalOf(slideRoot: HTMLElement, elementId: string): NaturalSize | null {
  const img = slideRoot.querySelector<HTMLImageElement>(
    `[data-element-id="${CSS.escape(elementId)}"] img`,
  );
  if (!img || !img.complete || img.naturalWidth <= 0) return null;
  return { width: img.naturalWidth, height: img.naturalHeight };
}

/** Прямоугольник в долях рамки объекта: слой кадрирования лежит в ней и поворачивается с ней. */
function placeIn(box: Box, rect: Rect): CSSProperties {
  const w = box.cx || 1;
  const h = box.cy || 1;
  return {
    position: 'absolute',
    left: `${((rect.x - box.x) / w) * 100}%`,
    top: `${((rect.y - box.y) / h) * 100}%`,
    width: `${(rect.cx / w) * 100}%`,
    height: `${(rect.cy / h) * 100}%`,
  };
}

/** Точка ручки на рамке: доли по x и y. */
function handlePoint(handle: CropHandle): { fx: number; fy: number } {
  return {
    fx: handle.includes('w') ? 0 : handle.includes('e') ? 1 : 0.5,
    fy: handle.includes('n') ? 0 : handle.includes('s') ? 1 : 0.5,
  };
}

/**
 * Режим кадрирования (F-30/F-31), как в Google Slides и Keynote: двойной клик по картинке
 * показывает её целиком полупрозрачной, поверх — яркий кадр с ручками. Ручки кадра двигают его
 * края, перетаскивание двигает картинку под кадром, угловые кружки меняют её масштаб.
 * Enter или клик мимо — применить (одна запись журнала), Esc — отменить.
 *
 * Слой лежит в кадре слайда поверх исходной картинки и поворачивается вместе с ней, поэтому
 * зум и пан двигают его сами. Полоса с кнопками — в экранном слое, одного размера при любом зуме.
 */
export function ImageCropper({
  slideRoot,
  overlay,
  element,
  size,
  url,
  onApply,
  onCancel,
  onReplace,
  finishRef,
}: {
  slideRoot: HTMLElement;
  overlay: HTMLElement;
  element: ImageElement;
  size: SlideSize;
  url: string;
  /** Итог: доли срезанного (null — без обрезки) и новая рамка объекта. */
  onApply: (crop: ImageCrop | null, box: Box) => void;
  onCancel: () => void;
  onReplace: () => void;
  /** Сюда кладётся «применить и закрыть» — для тех, кто закрывает режим снаружи (показ). */
  finishRef?: { current: (() => void) | null };
}) {
  const t = useTranslations('imageCrop');
  const { box } = element;
  const rotation = element.rotation ?? 0;
  const [state, setState] = useState<CropState>(() =>
    cropStart(element, naturalOf(slideRoot, element.elementId)),
  );
  const latest = useRef(state);
  latest.current = state;
  // Кадр, с которого начали: закрыть его без правок — не правка, и в журнал ничего не идёт.
  const initial = useRef(state);
  const [frameNode, setFrameNode] = useState<HTMLDivElement | null>(null);
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const layer = useRef<HTMLDivElement | null>(null);
  const [zoomTick, setZoomTick] = useState(0);
  const bump = useCallback(() => setZoomTick((tick) => tick + 1), []);
  useTransformEffect(bump);
  const [place, setPlace] = useState<{ x: number; y: number } | null>(null);
  const gesture = useRef<{
    readonly gesture: Gesture;
    readonly pointerId: number;
    readonly x: number;
    readonly y: number;
    readonly start: CropState;
    readonly emuPerPx: number;
  } | null>(null);

  /** Сколько EMU слайда в экранном пикселе сейчас: зум и вписывание вместе. */
  const emuPerPx = useCallback(() => {
    const width = slideRoot.getBoundingClientRect().width;
    return width > 0 ? size.cx / width : 1;
  }, [size.cx, slideRoot]);

  const apply = useCallback(() => {
    if (JSON.stringify(latest.current) === JSON.stringify(initial.current)) {
      onCancel();
      return;
    }
    const result = cropResult(latest.current);
    onApply(result.crop, placeRotated(box, rotation, result.frame));
  }, [box, onApply, onCancel, rotation]);

  useEffect(() => {
    if (!finishRef) return;
    finishRef.current = apply;
    return () => {
      if (finishRef.current === apply) finishRef.current = null;
    };
  }, [apply, finishRef]);

  // Клавиши, пока открыт кадр: Enter применяет, Esc отменяет, стрелки двигают картинку.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        apply();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const arrow = arrows[event.key];
      if (!arrow || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      const current = latest.current;
      const step = event.shiftKey ? ARROW_STEP_LARGE : ARROW_STEP;
      setState(
        moveImage(current, arrow[0] * step * current.frame.cx, arrow[1] * step * current.frame.cy),
      );
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [apply, onCancel]);

  // Клик мимо кадра и его полосы — применить, как в PowerPoint. Средняя кнопка тащит холст.
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (event.button === 1) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (layer.current?.contains(target) || toolbar?.contains(target)) return;
      apply();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [apply, toolbar]);

  // Полоса под кадром (или над ним, если снизу тесно), в экранных пикселях слоя.
  useLayoutEffect(() => {
    if (!frameNode || !toolbar) return;
    const origin = overlay.getBoundingClientRect();
    const rect = frameNode.getBoundingClientRect();
    const width = toolbar.offsetWidth;
    const height = toolbar.offsetHeight;
    const below = rect.bottom - origin.top + TOOLBAR_GAP;
    const y =
      below + height <= origin.height ? below : rect.top - origin.top - TOOLBAR_GAP - height;
    const x = Math.min(
      Math.max(rect.left - origin.left + rect.width / 2 - width / 2, TOOLBAR_GAP),
      Math.max(TOOLBAR_GAP, origin.width - width - TOOLBAR_GAP),
    );
    setPlace((previous) =>
      previous && previous.x === x && previous.y === Math.max(TOOLBAR_GAP, y)
        ? previous
        : { x, y: Math.max(TOOLBAR_GAP, y) },
    );
  }, [frameNode, overlay, state, toolbar, zoomTick]);

  const begin = (next: Gesture) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      gesture: next,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start: latest.current,
      emuPerPx: emuPerPx(),
    };
  };
  const onMove = (event: ReactPointerEvent<HTMLElement>) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const local = toLocal(
      (event.clientX - active.x) * active.emuPerPx,
      (event.clientY - active.y) * active.emuPerPx,
      rotation,
    );
    const { start } = active;
    const kind = active.gesture;
    if (kind.kind === 'move') setState(moveImage(start, local.dx, local.dy));
    else if (kind.kind === 'frame') {
      setState(resizeFrame(start, kind.handle, local.dx, local.dy, MIN_FRAME_PX * active.emuPerPx));
    } else setState(scaleImage(start, kind.corner, local.dx, local.dy));
  };
  const onUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (gesture.current?.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const pointer = { onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp };

  const { image, frame } = state;
  // Размеры ручек в EMU по текущему зуму, затем в доли рамки объекта.
  const unit = emuPerPx();
  const shareX = (px: number) => `${((px * unit) / (box.cx || 1)) * 100}%`;
  const shareY = (px: number) => `${((px * unit) / (box.cy || 1)) * 100}%`;
  const imageInFrame: CSSProperties = {
    position: 'absolute',
    left: `${((image.x - frame.x) / (frame.cx || 1)) * 100}%`,
    top: `${((image.y - frame.y) / (frame.cy || 1)) * 100}%`,
    width: `${(image.cx / (frame.cx || 1)) * 100}%`,
    height: `${(image.cy / (frame.cy || 1)) * 100}%`,
    maxWidth: 'none',
    objectFit: 'fill',
  };

  return (
    <>
      {createPortal(
        <>
          <style>{`[data-canvas-slide] [data-slide-root] > [data-element-id="${CSS.escape(element.elementId)}"] { visibility: hidden; }`}</style>
          <div
            ref={layer}
            data-image-crop=""
            role="group"
            aria-label={t('label')}
            style={{
              ...boxStyle(box, size),
              zIndex: 3,
              overflow: 'visible',
              ...(rotation ? { transform: `rotate(${rotation}deg)` } : null),
            }}
          >
            {/* Вся картинка, приглушённая: видно, что останется за кадром. */}
            <img
              alt=""
              src={url}
              draggable={false}
              aria-label={t('picture')}
              data-crop-picture=""
              onPointerDown={begin({ kind: 'move' })}
              {...pointer}
              style={{
                ...placeIn(box, image),
                maxWidth: 'none',
                objectFit: 'fill',
                opacity: 0.4,
                cursor: 'move',
                touchAction: 'none',
              }}
            />
            <div
              ref={setFrameNode}
              data-crop-frame=""
              aria-label={t('frame')}
              onPointerDown={begin({ kind: 'move' })}
              {...pointer}
              style={{
                ...placeIn(box, frame),
                overflow: 'hidden',
                cursor: 'move',
                touchAction: 'none',
                outline: '1px solid var(--canvas-selection)',
              }}
            >
              <img alt="" src={url} draggable={false} style={imageInFrame} />
            </div>
            {CROP_CORNERS.map((corner) => {
              const { fx, fy } = handlePoint(corner);
              return (
                <span
                  key={`scale-${corner}`}
                  data-crop-corner={corner}
                  aria-label={t('corner')}
                  onPointerDown={begin({ kind: 'scale', corner })}
                  {...pointer}
                  className="absolute rounded-full border border-[var(--canvas-selection)] bg-background"
                  style={{
                    left: `calc(${((image.x + image.cx * fx - box.x) / (box.cx || 1)) * 100}% - ${shareX(CORNER_PX / 2)})`,
                    top: `calc(${((image.y + image.cy * fy - box.y) / (box.cy || 1)) * 100}% - ${shareY(CORNER_PX / 2)})`,
                    width: shareX(CORNER_PX),
                    height: shareY(CORNER_PX),
                    cursor: CURSOR[corner],
                    touchAction: 'none',
                  }}
                />
              );
            })}
            {CROP_HANDLES.map((handle) => {
              const { fx, fy } = handlePoint(handle);
              const edge = handle.length === 1;
              const wide = edge && (handle === 'n' || handle === 's');
              const w = edge ? (wide ? EDGE_PX : HANDLE_PX / 2) : HANDLE_PX;
              const h = edge ? (wide ? HANDLE_PX / 2 : EDGE_PX) : HANDLE_PX;
              return (
                <span
                  key={handle}
                  data-crop-handle={handle}
                  aria-label={t('handle')}
                  onPointerDown={begin({ kind: 'frame', handle })}
                  {...pointer}
                  className="absolute rounded-[2px] bg-foreground ring-2 ring-background"
                  style={{
                    left: `calc(${((frame.x + frame.cx * fx - box.x) / (box.cx || 1)) * 100}% - ${shareX(w / 2)})`,
                    top: `calc(${((frame.y + frame.cy * fy - box.y) / (box.cy || 1)) * 100}% - ${shareY(h / 2)})`,
                    width: shareX(w),
                    height: shareY(h),
                    cursor: CURSOR[handle],
                    touchAction: 'none',
                  }}
                />
              );
            })}
          </div>
        </>,
        slideRoot,
      )}
      {createPortal(
        <div
          ref={setToolbar}
          role="toolbar"
          aria-label={t('label')}
          data-crop-toolbar=""
          className="pointer-events-auto absolute z-[3001] flex items-center gap-0.5 rounded-xl bg-card p-1 text-xs shadow-lg ring-1 shadow-black/25 ring-border"
          style={{
            left: place?.x ?? 0,
            top: place?.y ?? 0,
            visibility: place ? 'visible' : 'hidden',
          }}
        >
          <ToolbarButton primary onClick={apply}>
            {t('done')}
          </ToolbarButton>
          <ToolbarButton onClick={() => setState(resetCrop(latest.current))}>
            {t('reset')}
          </ToolbarButton>
          <ToolbarButton onClick={onReplace}>{t('replace')}</ToolbarButton>
          <ToolbarButton onClick={onCancel}>{t('cancel')}</ToolbarButton>
        </div>,
        overlay,
      )}
    </>
  );
}

function ToolbarButton({
  primary = false,
  onClick,
  children,
}: {
  primary?: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-7 rounded-lg px-2.5 font-medium whitespace-nowrap outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring',
        primary
          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
          : 'text-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}
