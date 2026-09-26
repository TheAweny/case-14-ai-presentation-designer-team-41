import { describe, expect, it } from 'vitest';
import { showAction, showStep, slideAfterShow } from './show-navigation';

function key(code: string, modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) {
  return {
    code,
    key: code,
    ctrlKey: modifiers.ctrl === true,
    metaKey: false,
    shiftKey: modifiers.shift === true,
    altKey: modifiers.alt === true,
  };
}

describe('slide show keys', () => {
  it('листает вперёд и назад клавишами PowerPoint', () => {
    for (const code of ['ArrowRight', 'ArrowDown', 'PageDown', 'Space', 'Enter', 'KeyN']) {
      expect(showAction(key(code)), code).toBe('next');
    }
    for (const code of ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'KeyP']) {
      expect(showAction(key(code)), code).toBe('previous');
    }
    expect(showAction(key('Home'))).toBe('first');
    expect(showAction(key('End'))).toBe('last');
    expect(showAction(key('Escape'))).toBe('exit');
  });

  it('глушит F5, чтобы браузер не перезагрузил страницу посреди показа', () => {
    expect(showAction(key('F5'))).toBe('ignore');
    expect(showAction(key('F5', { shift: true }))).toBe('ignore');
  });

  it('не трогает сочетания браузера и системы', () => {
    expect(showAction(key('ArrowRight', { ctrl: true }))).toBeNull();
    expect(showAction(key('Tab', { alt: true }))).toBeNull();
    expect(showAction(key('KeyQ'))).toBeNull();
  });
});

describe('slide show steps', () => {
  it('идёт по слайдам, после последнего — экран конца, с него — выход', () => {
    expect(showStep(0, 'next', 3)).toBe(1);
    expect(showStep(2, 'next', 3)).toBe(3);
    expect(showStep(3, 'next', 3)).toBe('exit');
  });

  it('назад упирается в первый слайд, с экрана конца ведёт на последний', () => {
    expect(showStep(0, 'previous', 3)).toBe(0);
    expect(showStep(2, 'previous', 3)).toBe(1);
    expect(showStep(3, 'previous', 3)).toBe(2);
  });

  it('Home и End — к краям колоды, Esc — выход', () => {
    expect(showStep(1, 'first', 3)).toBe(0);
    expect(showStep(0, 'last', 3)).toBe(2);
    expect(showStep(1, 'exit', 3)).toBe('exit');
    expect(showStep(0, 'next', 0)).toBe('exit');
  });

  it('после показа редактор открывает слайд, на котором остановились', () => {
    expect(slideAfterShow(1, 3)).toBe(1);
    expect(slideAfterShow(3, 3)).toBe(2);
  });
});
