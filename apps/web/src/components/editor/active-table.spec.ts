import { describe, expect, it } from 'vitest';
import { activeTable, clearActiveTable, setActiveTable } from './active-table';

describe('active table', () => {
  it('keeps the open table and its range until that table closes', () => {
    const range = { top: 1, left: 0, bottom: 1, right: 2 };
    setActiveTable({ elementId: 'grid', range });
    const first = activeTable();
    expect(first).toEqual({ elementId: 'grid', range });
    // The same range again is not a change: readers keep the object they have.
    setActiveTable({ elementId: 'grid', range: { ...range } });
    expect(activeTable()).toBe(first);
    // Another table closing does not clear the one that is open.
    clearActiveTable('other');
    expect(activeTable()).toBe(first);
    clearActiveTable('grid');
    expect(activeTable()).toBeNull();
  });
});
