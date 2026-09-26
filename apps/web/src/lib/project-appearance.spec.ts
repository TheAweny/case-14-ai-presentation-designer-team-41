import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECT_APPEARANCE,
  PROJECT_COLOR_IDS,
  PROJECT_ICON_IDS,
  isProjectColorId,
  isProjectIconId,
  parseProjectAppearance,
  projectColorVar,
} from './project-appearance';

describe('project appearance', () => {
  it('по умолчанию — папка и серый, первые в своих наборах', () => {
    expect(DEFAULT_PROJECT_APPEARANCE).toEqual({ icon: 'folder', color: 'gray' });
    expect(PROJECT_ICON_IDS[0]).toBe(DEFAULT_PROJECT_APPEARANCE.icon);
    expect(PROJECT_COLOR_IDS[0]).toBe(DEFAULT_PROJECT_APPEARANCE.color);
  });

  it('в наборах нет повторов', () => {
    expect(new Set(PROJECT_ICON_IDS).size).toBe(PROJECT_ICON_IDS.length);
    expect(new Set(PROJECT_COLOR_IDS).size).toBe(PROJECT_COLOR_IDS.length);
  });

  it('узнаёт свои значения и не узнаёт чужие', () => {
    expect(isProjectIconId('rocket')).toBe(true);
    expect(isProjectIconId('unicorn')).toBe(false);
    expect(isProjectIconId(3)).toBe(false);
    expect(isProjectColorId('teal')).toBe(true);
    expect(isProjectColorId('#ff0000')).toBe(false);
    expect(isProjectColorId(null)).toBe(false);
  });

  it('знакомый внешний вид разбирается как есть', () => {
    expect(parseProjectAppearance({ icon: 'rocket', color: 'purple' })).toEqual({
      icon: 'rocket',
      color: 'purple',
    });
  });

  it('незнакомые иконка и цвет заменяются по отдельности', () => {
    expect(parseProjectAppearance({ icon: 'unicorn', color: 'blue' })).toEqual({
      icon: 'folder',
      color: 'blue',
    });
    expect(parseProjectAppearance({ icon: 'book', color: 'ultraviolet' })).toEqual({
      icon: 'book',
      color: 'gray',
    });
  });

  it('не объект — значение по умолчанию', () => {
    for (const value of [undefined, null, 'rocket', 42, []]) {
      expect(parseProjectAppearance(value)).toEqual(DEFAULT_PROJECT_APPEARANCE);
    }
  });

  it('лишние поля отбрасываются', () => {
    expect(parseProjectAppearance({ icon: 'star', color: 'yellow', extra: 1 })).toEqual({
      icon: 'star',
      color: 'yellow',
    });
  });

  it('цвет — токен оболочки', () => {
    expect(projectColorVar('green')).toBe('var(--project-green)');
  });
});
