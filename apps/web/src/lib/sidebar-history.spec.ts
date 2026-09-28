import { describe, expect, it } from 'vitest';
import {
  buildSidebarLists,
  historyGroups,
  type SidebarDeckRef,
  type SidebarProjectRef,
} from './sidebar-history';

const now = new Date(2026, 8, 28, 18, 0, 0).getTime();

function deck(deckId: string, title: string, projectId: string | null, at: Date): SidebarDeckRef {
  return { deckId, title, projectId, updatedAt: at.getTime() };
}

function project(projectId: string, name: string, pinnedAt: number | null): SidebarProjectRef {
  return { projectId, name, pinned: pinnedAt !== null, pinnedAt };
}

const decks = [
  deck('today-late', 'Итоги квартала', 'sales', new Date(2026, 8, 28, 16)),
  deck('today-early', 'Питч за три минуты', 'hackathon', new Date(2026, 8, 28, 9)),
  deck('yesterday', 'Адаптация', null, new Date(2026, 8, 27, 22)),
  deck('older-late', 'План внедрения', null, new Date(2026, 8, 20, 15)),
  deck('older-early', 'Предложение клиенту', 'sales', new Date(2026, 8, 20, 8)),
];

describe('historyGroups', () => {
  it('делит на сегодня, вчера и дату, внутри дня новые сверху', () => {
    const groups = historyGroups(decks, now);
    expect(groups.map((group) => group.day.kind)).toEqual(['today', 'yesterday', 'date']);
    expect(groups[0]?.items.map((item) => item.deckId)).toEqual(['today-late', 'today-early']);
    expect(groups[1]?.items.map((item) => item.deckId)).toEqual(['yesterday']);
    expect(groups[2]?.items.map((item) => item.deckId)).toEqual(['older-late', 'older-early']);
    expect(groups[2]?.day).toEqual({ kind: 'date', at: new Date(2026, 8, 20).getTime() });
  });

  it('вчера через границу месяца — предыдущий календарный день', () => {
    const march = new Date(2026, 2, 1, 10).getTime();
    const groups = historyGroups([deck('feb', 'Февраль', null, new Date(2026, 1, 28, 23))], march);
    expect(groups.map((group) => group.day.kind)).toEqual(['yesterday']);
  });

  it('не меняет переданный список', () => {
    const items = [decks[4], decks[0]].filter((item) => item !== undefined);
    const before = items.map((item) => item.deckId);
    historyGroups(items, now);
    expect(items.map((item) => item.deckId)).toEqual(before);
  });
});

describe('buildSidebarLists', () => {
  const projects = [
    project('hackathon', 'ЛЦТ-2026', new Date(2026, 8, 1).getTime()),
    project('sales', 'Отдел продаж', new Date(2026, 8, 20).getTime()),
    project('loose', 'Черновики', null),
  ];

  const lists = (open: readonly string[], query = '') =>
    buildSidebarLists({
      projects,
      decks,
      openProjectIds: new Set(open),
      query,
      now,
    });

  it('недавно закреплённые сверху; незакреплённый проект в этот список не попадает', () => {
    const result = lists([]);
    expect(result.pinned.map((row) => row.project.projectId)).toEqual(['sales', 'hackathon']);
    expect(result.pinned.every((row) => row.open === false)).toBe(true);
    expect(result.pinnedVacant).toBe(false);
  });

  it('презентации раскрытого проекта не повторяются в истории', () => {
    const result = lists(['sales']);
    const sales = result.pinned.find((row) => row.project.projectId === 'sales');
    expect(sales?.open).toBe(true);
    expect(sales?.decks.map((item) => item.deckId)).toEqual(['today-late', 'older-early']);
    const historyIds = result.groups.flatMap((group) => group.items.map((item) => item.deckId));
    expect(historyIds).toEqual(['today-early', 'yesterday', 'older-late']);
    expect(historyIds).not.toContain('today-late');
  });

  it('свёрнутый закреплённый проект отпускает презентации в историю', () => {
    const historyIds = lists([]).groups.flatMap((group) => group.items.map((item) => item.deckId));
    expect(historyIds).toContain('today-late');
    expect(historyIds).toContain('today-early');
    expect(historyIds[0]).toBe('today-late');
  });

  it('поиск по имени проекта раскрывает его и убирает его презентации из истории', () => {
    const result = lists([], 'отдел');
    expect(result.pinned.map((row) => row.project.projectId)).toEqual(['sales']);
    expect(result.pinned[0]?.open).toBe(true);
    expect(result.pinned[0]?.decks.map((item) => item.deckId)).toEqual([
      'today-late',
      'older-early',
    ]);
    const historyIds = result.groups.flatMap((group) => group.items.map((item) => item.deckId));
    expect(historyIds).not.toContain('today-late');
    expect(result.searchMiss).toBe(false);
  });

  it('поиск по названию оставляет только совпавшую презентацию', () => {
    const result = lists(['sales'], 'питч');
    expect(result.pinned.map((row) => row.project.projectId)).toEqual(['hackathon']);
    expect(result.pinned[0]?.decks.map((item) => item.deckId)).toEqual(['today-early']);
    expect(result.groups.flatMap((group) => group.items)).toEqual([]);
  });

  it('пустой поиск без совпадений — searchMiss, а пустая библиотека — vacant', () => {
    expect(lists([], 'нет такого').searchMiss).toBe(true);
    const empty = buildSidebarLists({
      projects: [project('loose', 'Черновики', null)],
      decks: [],
      openProjectIds: new Set<string>(),
      query: '',
      now,
    });
    expect(empty.pinnedVacant).toBe(true);
    expect(empty.historyVacant).toBe(true);
    expect(empty.searchMiss).toBe(false);
  });
});
