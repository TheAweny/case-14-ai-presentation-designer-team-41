import { describe, expect, it } from 'vitest';
import {
  SPLASH_DELAY_MS,
  SPLASH_HANDOFF_MS,
  SPLASH_MIN_SHOWN_MS,
  createSplashRelay,
  splashFadeDelayMs,
  splashHoldMs,
} from './splash-timing';

describe('splashHoldMs', () => {
  it('убирает сразу заставку, которая не успела проявиться', () => {
    expect(splashHoldMs(1000, 1000 + SPLASH_DELAY_MS - 1)).toBeNull();
  });

  it('держит проявившуюся заставку до минимального времени показа', () => {
    const visibleAt = 1000 + SPLASH_DELAY_MS;
    expect(splashHoldMs(1000, visibleAt + 100)).toBe(SPLASH_MIN_SHOWN_MS - 100);
  });

  it('не держит заставку, которая показывалась дольше минимума', () => {
    expect(splashHoldMs(1000, 1000 + SPLASH_DELAY_MS + SPLASH_MIN_SHOWN_MS + 1)).toBe(0);
  });
});

describe('splashFadeDelayMs', () => {
  it('новая заставка проявляется через полную задержку', () => {
    expect(splashFadeDelayMs(500, 500)).toBe(SPLASH_DELAY_MS);
  });

  it('продолженная заставка проявляется через остаток задержки', () => {
    expect(splashFadeDelayMs(500, 580)).toBe(SPLASH_DELAY_MS - 80);
  });

  it('заставка на экране не проявляется заново', () => {
    expect(splashFadeDelayMs(500, 500 + SPLASH_DELAY_MS)).toBeNull();
  });
});

describe('createSplashRelay', () => {
  it('первая заставка начинается сейчас', () => {
    expect(createSplashRelay().start(700)).toBe(700);
  });

  it('заставка сразу после другой продолжает её отсчёт', () => {
    const relay = createSplashRelay();
    relay.leave(100, 900);
    expect(relay.start(900 + SPLASH_HANDOFF_MS)).toBe(100);
  });

  it('заставка намного позже начинается заново', () => {
    const relay = createSplashRelay();
    relay.leave(100, 900);
    expect(relay.start(900 + SPLASH_HANDOFF_MS + 1)).toBe(900 + SPLASH_HANDOFF_MS + 1);
  });

  it('повторный вызов start даёт тот же ответ', () => {
    const relay = createSplashRelay();
    relay.leave(100, 900);
    expect(relay.start(950)).toBe(relay.start(950));
  });
});
