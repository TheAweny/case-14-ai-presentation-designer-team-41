'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { ChevronDownIcon } from '@/components/ui/icons';
import { useControls, useTransformComponent, useTransformContext } from 'react-zoom-pan-pinch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { keepCanvasFocus, useMenuFocus } from '@/components/editor/chrome-focus';
import { ZOOM_PRESETS, zoomPercent, zoomScaleFor } from '@/components/editor/zoom-input';

/**
 * Ширина слайда в EMU. По ней масштаб считается в процентах от размера слайда в шаблоне:
 * 100 % — слайд ровно такой, каким он уйдёт в .pptx. Значение кладёт редактор: сам HUD живёт
 * внутри холста и о колоде ничего не знает.
 */
const SlideWidthEmu = createContext<number | null>(null);

export function ZoomBasis({
  slideWidthEmu,
  children,
}: {
  slideWidthEmu: number;
  children: ReactNode;
}) {
  return <SlideWidthEmu.Provider value={slideWidthEmu}>{children}</SlideWidthEmu.Provider>;
}

/**
 * После смены слайда лист снова вписан в холст. Первый показ оставляет начальный масштаб:
 * библиотека и так ставит его в центр.
 */
export function FitSlide({ slideId }: { slideId: string }) {
  const { centerView } = useControls();
  const seen = useRef(slideId);
  useEffect(() => {
    if (seen.current === slideId) return;
    seen.current = slideId;
    void centerView(1, 0);
  }, [centerView, slideId]);
  return null;
}

/** Ширина вписанного листа в пикселях вёрстки: от неё считается процент. */
function useFittedWidth(): number {
  const instance = useTransformContext();
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const content = instance.contentComponent;
    if (!content) return;
    const measure = () => {
      const slide = content.querySelector<HTMLElement>('[data-slide-root]');
      setWidth(slide?.offsetWidth ?? 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [instance]);

  return width;
}

/**
 * Масштаб холста: процент в углу области, по клику — меню. Стоит в правом нижнем углу, как
 * в Figma, и помечен как препятствие — рейка инструментов на него не встаёт.
 */
export function ZoomHud({
  onZoomToSelection,
  className,
}: {
  /** «К выделению»: пункт появляется, только когда холст умеет это делать. */
  onZoomToSelection?: () => void;
  className?: string;
}) {
  const t = useTranslations('editor');
  const reduceMotion = useReducedMotion() === true;
  const instance = useTransformContext();
  const { centerView } = useControls();
  const focus = useMenuFocus();
  const scale = useTransformComponent((context) => context.state.scale);
  const fitted = useFittedWidth();
  const slideWidthEmu = useContext(SlideWidthEmu) ?? 0;
  const percent = zoomPercent(scale, fitted, slideWidthEmu);
  const motion = reduceMotion ? 0 : 160;
  const { minScale, maxScale } = instance.setup;

  const zoomTo = (ratio: number) => {
    void centerView(zoomScaleFor(ratio, fitted, slideWidthEmu), motion);
  };
  const reachable = (ratio: number) => {
    const target = zoomScaleFor(ratio, fitted, slideWidthEmu);
    return target >= minScale - 0.001 && target <= maxScale + 0.001;
  };

  return (
    <div data-dock-obstacle="" className={cn('absolute right-3 bottom-3 z-30', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('zoomValue', { percent })}
            onMouseDown={keepCanvasFocus}
            {...focus.trigger}
            className={cn(
              'flex h-8 items-center gap-0.5 rounded-lg bg-card pr-1 pl-2.5 outline-none',
              'text-xs font-medium text-foreground tabular-nums',
              'shadow-lg ring-1 shadow-black/25 ring-border',
              'transition-colors duration-100 motion-reduce:transition-none',
              'hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50',
              'data-[state=open]:bg-muted',
            )}
          >
            <span aria-hidden>{t('zoomPercent', { percent })}</span>
            <ChevronDownIcon size={14} className="text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          aria-label={t('zoom')}
          onCloseAutoFocus={focus.onCloseAutoFocus}
          className="z-[4000] w-auto min-w-44"
        >
          <DropdownMenuItem onSelect={() => void centerView(1, motion)}>
            {t('zoomFit')}
          </DropdownMenuItem>
          {onZoomToSelection && (
            <DropdownMenuItem onSelect={onZoomToSelection}>{t('zoomSelection')}</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {ZOOM_PRESETS.map((ratio) => (
            <DropdownMenuItem
              key={ratio}
              disabled={!reachable(ratio)}
              onSelect={() => zoomTo(ratio)}
            >
              {t('zoomPercent', { percent: Math.round(ratio * 100) })}
              {ratio === 1 && <DropdownMenuShortcut>{t('zoomTemplateSize')}</DropdownMenuShortcut>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
