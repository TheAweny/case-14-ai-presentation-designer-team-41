'use client';

import { useCallback, useEffect, useRef, type FocusEvent, type RefObject } from 'react';
import { useReducedMotion } from 'motion/react';

/**
 * Движок «Авроры» — свечения поля генерации. Состояние окна (покой, наведение, фокус,
 * ввод, генерация) сводится к трём CSS-переменным на корне: `--aurora-angle`,
 * `--aurora-energy`, `--aurora-pulse`. Рисует их CSS (`.aurora` в `globals.css`).
 *
 * Всё меняется без скачков: у каждой величины есть цель, и значение догоняет её по экспоненте.
 * Поэтому быстрый набор разгоняет вращение, а не дёргает его. В покое цикл кадров
 * останавливается: рамка замирает и не тратит кадры, пока на неё никто не смотрит.
 */

/** Энергия в покое, при наведении и в фокусе. Генерация — всегда 1. */
const ENERGY_IDLE = 0.08;
const ENERGY_HOVER = 0.3;
const ENERGY_FOCUS = 0.6;
/** Добавка к фокусу, когда текст уже есть и можно отправлять. */
const ENERGY_READY = 0.1;

/** Скорость вращения, градусов в секунду: в покое, от энергии и в генерации. */
const SPIN_BASE = 14;
const SPIN_ENERGY = 36;
const SPIN_SENDING = 260;
/** Разгон от одного нажатия и потолок разгона. */
const SPIN_KICK = 22;
const SPIN_KICK_MAX = 90;

/** Волна от нажатия, её потолок и волна от смены шаблона. */
const PULSE_KICK = 0.18;
const PULSE_MAX = 0.7;
const PULSE_TEMPLATE = 0.55;

/** Меньше этого считаем, что величина пришла к цели. */
const SETTLED = 0.002;

interface AuroraState {
  hover: boolean;
  focus: boolean;
  ready: boolean;
  sending: boolean;
  energy: number;
  pulse: number;
  pulseTarget: number;
  spin: number;
  spinTarget: number;
  boost: number;
  angle: number;
}

/** Значение, догоняющее цель со скоростью `rate` в секунду. */
const follow = (from: number, to: number, rate: number, dt: number) =>
  from + (to - from) * (1 - Math.exp(-dt * rate));

export interface Aurora {
  /** Обработчики на корень окна: наведение и фокус внутри него. */
  readonly handlers: {
    onPointerEnter: () => void;
    onPointerLeave: () => void;
    onFocus: () => void;
    onBlur: (event: FocusEvent<HTMLElement>) => void;
  };
  /** Нажатие в поле: короткая волна и разгон вращения. */
  kick: () => void;
  /** Сменился шаблон: волна, пока цвет перетекает в цвет его проекта. */
  flash: () => void;
}

export function useAurora(
  root: RefObject<HTMLElement | null>,
  { ready, sending }: { ready: boolean; sending: boolean },
): Aurora {
  const reduceMotion = useReducedMotion() === true;
  const state = useRef<AuroraState>({
    hover: false,
    focus: false,
    ready,
    sending,
    energy: ENERGY_IDLE,
    pulse: 0,
    pulseTarget: 0,
    spin: 0,
    spinTarget: 0,
    boost: 0,
    angle: 0,
  });
  const frame = useRef<number | null>(null);
  const last = useRef(0);

  const tick = useCallback(
    (now: number) => {
      const s = state.current;
      const dt = Math.min(0.05, (now - last.current) / 1000);
      last.current = now;

      const target = s.sending
        ? 1
        : Math.max(
            s.focus ? ENERGY_FOCUS + (s.ready ? ENERGY_READY : 0) : 0,
            s.hover ? ENERGY_HOVER : 0,
            ENERGY_IDLE,
          );
      s.energy = follow(s.energy, target, 5, dt);
      s.pulseTarget *= Math.exp(-dt * 1.6);
      s.pulse = follow(s.pulse, s.pulseTarget, 9, dt);
      s.spinTarget *= Math.exp(-dt * 1.4);
      s.spin = follow(s.spin, s.spinTarget, 5, dt);
      s.boost = follow(s.boost, s.sending ? SPIN_SENDING : 0, s.sending ? 3 : 2, dt);

      const active = s.hover || s.focus || s.sending;
      if (!reduceMotion && (active || s.boost > 1 || s.spin > 1)) {
        s.angle = (s.angle + (SPIN_BASE + s.energy * SPIN_ENERGY + s.spin + s.boost) * dt) % 360;
      }

      const element = root.current;
      if (element) {
        element.style.setProperty('--aurora-angle', `${s.angle.toFixed(2)}deg`);
        element.style.setProperty('--aurora-energy', s.energy.toFixed(3));
        element.style.setProperty('--aurora-pulse', s.pulse.toFixed(3));
      }

      const settled =
        !active &&
        Math.abs(s.energy - target) < SETTLED &&
        s.pulse < SETTLED &&
        s.pulseTarget < SETTLED &&
        s.boost < 1 &&
        s.spin < 1;
      frame.current = settled ? null : requestAnimationFrame(tick);
    },
    [root, reduceMotion],
  );

  const wake = useCallback(() => {
    if (frame.current !== null) return;
    last.current = performance.now();
    frame.current = requestAnimationFrame(tick);
  }, [tick]);

  useEffect(() => {
    state.current.ready = ready;
    state.current.sending = sending;
    wake();
  }, [ready, sending, wake]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    [],
  );

  const set = useCallback(
    (patch: Partial<AuroraState>) => {
      Object.assign(state.current, patch);
      wake();
    },
    [wake],
  );

  return {
    handlers: {
      onPointerEnter: () => set({ hover: true }),
      onPointerLeave: () => set({ hover: false }),
      onFocus: () => set({ focus: true }),
      onBlur: (event) => {
        // Фокус ушёл внутрь того же окна (с поля на кнопку шаблона) — окно всё ещё в фокусе.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          set({ focus: false });
        }
      },
    },
    kick: () => {
      const s = state.current;
      set({
        pulseTarget: Math.min(PULSE_MAX, s.pulseTarget + PULSE_KICK),
        spinTarget: Math.min(SPIN_KICK_MAX, s.spinTarget + SPIN_KICK),
      });
    },
    flash: () => set({ pulseTarget: Math.max(state.current.pulseTarget, PULSE_TEMPLATE) }),
  };
}
