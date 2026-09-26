import { describe, expect, it } from 'vitest';
import { parseProjectTab, selectedTemplateId } from './project-tab';

describe('parseProjectTab', () => {
  it('знакомая вкладка — она, остальное — презентации', () => {
    expect(parseProjectTab('templates')).toBe('templates');
    expect(parseProjectTab('decks')).toBe('decks');
    expect(parseProjectTab('template')).toBe('decks');
    expect(parseProjectTab(['templates', 'decks'])).toBe('decks');
    expect(parseProjectTab(null)).toBe('decks');
    expect(parseProjectTab(undefined)).toBe('decks');
  });
});

describe('selectedTemplateId', () => {
  const ids = ['warm', 'neutral'];

  it('шаблон из адреса, если он прикреплён к проекту', () => {
    expect(selectedTemplateId('neutral', ids)).toBe('neutral');
  });

  it('без адреса или с откреплённым шаблоном — первый шаблон проекта', () => {
    expect(selectedTemplateId(null, ids)).toBe('warm');
    expect(selectedTemplateId('gone', ids)).toBe('warm');
    expect(selectedTemplateId(['neutral'], ids)).toBe('warm');
  });

  it('шаблонов нет — ничего не выбрано', () => {
    expect(selectedTemplateId('warm', [])).toBeNull();
  });
});
