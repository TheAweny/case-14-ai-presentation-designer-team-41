/**
 * Состав боковой панели: закреплённые проекты и история презентаций.
 * Презентация здесь — чат: её место в истории задаёт время последней правки, новые сверху.
 * Модуль без React: группировку по дням и то, что не дублируется под раскрытым проектом,
 * проверяют тесты.
 */

/** Что панели нужно о проекте, чтобы разложить закреплённые. */
export interface SidebarProjectRef {
  readonly projectId: string;
  readonly name: string;
  readonly pinned: boolean;
  readonly pinnedAt: number | null;
}

/** Что панели нужно о презентации. */
export interface SidebarDeckRef {
  readonly deckId: string;
  readonly title: string;
  readonly projectId: string | null;
  readonly updatedAt: number;
}

/** День группы истории. `at` у даты — полночь этого дня в локальной зоне. */
export type HistoryDay =
  | { readonly kind: 'today' }
  | { readonly kind: 'yesterday' }
  | { readonly kind: 'date'; readonly at: number };

export interface HistoryGroup<T> {
  readonly day: HistoryDay;
  readonly items: readonly T[];
}

/** Закреплённый проект в панели и презентации, которые сейчас показаны под ним. */
export interface PinnedRow<P, D> {
  readonly project: P;
  readonly decks: readonly D[];
  readonly open: boolean;
}

export interface SidebarLists<P, D> {
  readonly pinned: readonly PinnedRow<P, D>[];
  readonly groups: readonly HistoryGroup<D>[];
  /** Закреплённых проектов нет вообще, а не потому что поиск их спрятал. */
  readonly pinnedVacant: boolean;
  /** Презентаций нет вообще. */
  readonly historyVacant: boolean;
  /** В поиске нет ни проекта, ни презентации. */
  readonly searchMiss: boolean;
}

/** Полночь локального дня. Сравнение дней не зависит от часа правки. */
export function startOfLocalDay(at: number): number {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function sameDay(a: HistoryDay, b: HistoryDay): boolean {
  if (a.kind === 'date' && b.kind === 'date') return a.at === b.at;
  return a.kind === b.kind;
}

function dayOf(updatedAt: number, today: number, yesterday: number): HistoryDay {
  const start = startOfLocalDay(updatedAt);
  if (start === today) return { kind: 'today' };
  if (start === yesterday) return { kind: 'yesterday' };
  return { kind: 'date', at: start };
}

/**
 * Группы от нового дня к старому. Внутри дня тоже новые сверху. Входной список не меняется.
 */
export function historyGroups<T extends { readonly updatedAt: number }>(
  items: readonly T[],
  now: number,
): readonly HistoryGroup<T>[] {
  const today = startOfLocalDay(now);
  const yesterdayDate = new Date(today);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.getTime();
  const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt);
  const groups: { day: HistoryDay; items: T[] }[] = [];
  for (const item of sorted) {
    const day = dayOf(item.updatedAt, today, yesterday);
    const last = groups.at(-1);
    if (last && sameDay(last.day, day)) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}

function needleOf(query: string): string {
  return query.trim().toLocaleLowerCase();
}

function hit(text: string, needle: string): boolean {
  return needle === '' || text.toLocaleLowerCase().includes(needle);
}

/**
 * Закреплённые — недавно закреплённые сверху. Под раскрытым проектом его презентации,
 * новые сверху; в общей истории их тогда нет, иначе одна и та же строка стояла бы дважды.
 * Свёрнутый закреплённый проект свои презентации в историю отпускает.
 * Поиск раскрывает совпавшие проекты и оставляет только совпавшие строки.
 */
export function buildSidebarLists<P extends SidebarProjectRef, D extends SidebarDeckRef>(input: {
  readonly projects: readonly P[];
  readonly decks: readonly D[];
  readonly openProjectIds: ReadonlySet<string>;
  readonly query: string;
  readonly now: number;
}): SidebarLists<P, D> {
  const needle = needleOf(input.query);
  const searching = needle !== '';
  const pinnedProjects = input.projects
    .filter((project) => project.pinned)
    .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));

  const pinned: PinnedRow<P, D>[] = [];
  const shown = new Set<string>();
  for (const project of pinnedProjects) {
    const own = input.decks
      .filter((deck) => deck.projectId === project.projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const nameHit = hit(project.name, needle);
    const matching = own.filter((deck) => hit(deck.title, needle));
    if (searching && !nameHit && matching.length === 0) continue;
    const open = searching || input.openProjectIds.has(project.projectId);
    // Имя проекта совпало — видны все его презентации. Совпало название — только оно.
    const visible = !searching || nameHit ? own : matching;
    if (open) for (const deck of visible) shown.add(deck.deckId);
    pinned.push({ project, decks: open ? visible : [], open });
  }

  const history = input.decks.filter((deck) => hit(deck.title, needle) && !shown.has(deck.deckId));
  const searchMiss = searching && pinned.length === 0 && history.length === 0;
  return {
    pinned,
    groups: historyGroups(history, input.now),
    pinnedVacant: pinnedProjects.length === 0,
    historyVacant: input.decks.length === 0,
    searchMiss,
  };
}
