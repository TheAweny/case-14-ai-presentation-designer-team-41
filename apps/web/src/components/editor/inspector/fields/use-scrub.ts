'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { clampNumber, formatNumber, roundTo } from '@/components/editor/inspector/number-input';
import {
  formatScrubDelta,
  scrubDelta,
  scrubStarted,
  scrubValue,
} from '@/components/editor/inspector/fields/scrub';

export interface ScrubOptions {
  /** Текущее значение; `null` — у выделенных оно разное, тогда тянется прирост. */
  readonly value: number | null;
  readonly enabled: boolean;
  readonly step: number;
  readonly min?: number;
  readonly max?: number;
  readonly precision: number;
  readonly onCommit: (value: number) => void;
  readonly onCommitEach?: (apply: (old: number) => number) => void;
  readonly onPreview?: (value: number) => void;
  readonly onPreviewEach?: (apply: (old: number) => number) => void;
  readonly onPreviewEnd?: () => void;
}

interface Gesture {
  readonly element: HTMLElement;
  readonly pointerId: number;
  readonly originX: number;
  readonly start: number | null;
  started: boolean;
  locked: boolean;
  finishing: boolean;
  accumulated: number;
  lastPreview: number | null;
  detach: () => void;
}

/**
 * Перетаскивание значения за подпись поля.
 *
 * Жест начинается после сдвига на несколько пикселей — до этого нажатие остаётся щелчком
 * по подписи (фокус в поле). Дальше указатель захватывается (pointer lock: курсор не упрётся
 * в край экрана; без него — захват указателя и курсор ew-resize на всей странице). Значение
 * в поле меняется живо, `onPreview` зовётся на каждое новое значение, `onCommit` — один раз
 * на отпускании: одна запись в истории на жест. Esc возвращает всё как было.
 */
export function useScrub(options: ScrubOptions) {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });

  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => () => gesture.current?.detach(), []);

  const bounded = (accumulated: number) => (old: number) => {
    const { min, max, precision } = latest.current;
    return clampNumber(roundTo(old + accumulated, precision), min, max);
  };

  const update = (current: Gesture) => {
    const { precision, onPreview, onPreviewEach } = latest.current;
    if (current.start === null) {
      setText(formatScrubDelta(current.accumulated, precision));
      onPreviewEach?.(bounded(current.accumulated));
      return;
    }
    const next = scrubValue(current.start, current.accumulated, latest.current);
    setText(formatNumber(next, precision));
    if (next !== current.lastPreview) {
      current.lastPreview = next;
      onPreview?.(next);
    }
  };

  const finish = (current: Gesture, commit: boolean) => {
    if (gesture.current !== current) return;
    gesture.current = null;
    current.finishing = true;
    current.detach();
    setText(null);
    if (!current.started) return;

    // Щелчок после жеста пришёлся бы на подпись и поставил фокус в поле — Figma так не делает.
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);

    const { onCommit, onCommitEach, onPreviewEnd, precision } = latest.current;
    if (commit) {
      if (current.start === null) {
        if (roundTo(current.accumulated, precision) !== 0) {
          onCommitEach?.(bounded(current.accumulated));
        }
      } else {
        const next = scrubValue(current.start, current.accumulated, latest.current);
        if (next !== current.start) onCommit(next);
      }
    }
    onPreviewEnd?.();
  };

  const begin = (current: Gesture) => {
    current.started = true;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    try {
      const request = current.element.requestPointerLock() as Promise<void> | undefined;
      request?.catch(() => undefined);
    } catch {
      // Без pointer lock жест работает на захвате указателя.
    }
    update(current);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const { enabled, value, onCommitEach } = latest.current;
    if (!enabled || event.button !== 0 || gesture.current) return;
    if (value === null && !onCommitEach) return;
    // Нажатие не забирает фокус: в открытом наборе текста выделение остаётся на месте.
    event.preventDefault();
    suppressClick.current = false;

    const element = event.currentTarget;
    const pointerId = event.pointerId;
    try {
      element.setPointerCapture(pointerId);
    } catch {
      // Захват не обязателен: слушатели висят на окне.
    }

    const onMove = (move: PointerEvent) => {
      const current = gesture.current;
      if (!current) return;
      if (!current.started) {
        if (scrubStarted(move.clientX - current.originX)) begin(current);
        return;
      }
      const { step, min, max } = latest.current;
      let accumulated = current.accumulated + scrubDelta(move.movementX, step, move);
      // Упёрлись в границу — обратное движение сразу меняет значение, без «мёртвого хода».
      if (current.start !== null) {
        accumulated = clampNumber(current.start + accumulated, min, max) - current.start;
      }
      if (accumulated === current.accumulated) return;
      current.accumulated = accumulated;
      update(current);
    };
    const onUp = () => {
      if (gesture.current) finish(gesture.current, true);
    };
    const onCancel = () => {
      if (gesture.current) finish(gesture.current, false);
    };
    const onKeyDown = (key: KeyboardEvent) => {
      const current = gesture.current;
      if (key.key !== 'Escape' || !current?.started) return;
      key.preventDefault();
      key.stopPropagation();
      finish(current, false);
    };
    const onLockChange = () => {
      const current = gesture.current;
      if (!current) return;
      if (document.pointerLockElement === current.element) {
        current.locked = true;
      } else if (current.locked && !current.finishing) {
        // Браузер снял захват сам — обычно это Esc, который до страницы не доходит.
        finish(current, false);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerlockchange', onLockChange);

    gesture.current = {
      element,
      pointerId,
      originX: event.clientX,
      start: latest.current.value,
      started: false,
      locked: false,
      finishing: false,
      accumulated: 0,
      lastPreview: null,
      detach: () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('blur', onCancel);
        window.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('pointerlockchange', onLockChange);
        try {
          if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
        } catch {
          // Элемент мог уже уйти из документа.
        }
        if (document.pointerLockElement === element) document.exitPointerLock();
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      },
    };
  };

  const onClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
  };

  const draggable = options.enabled && (options.value !== null || Boolean(options.onCommitEach));

  return {
    /** Текст поля во время жеста; `null` — жеста нет. */
    text,
    draggable,
    handleProps: { onPointerDown, onClick },
  };
}
