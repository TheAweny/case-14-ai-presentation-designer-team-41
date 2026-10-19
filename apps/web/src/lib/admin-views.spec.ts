import { describe, expect, it } from 'vitest';
import { ADMIN_VIEWS, adminView } from './admin-views';

describe('admin views', () => {
  it('lists the sections in the order the dashboard shows them', () => {
    expect(ADMIN_VIEWS).toEqual(['overview', 'people', 'limits', 'metrics']);
  });

  it('opens overview when the address has no known section', () => {
    expect(adminView(null)).toBe('overview');
    expect(adminView(undefined)).toBe('overview');
    expect(adminView('')).toBe('overview');
    expect(adminView('billing')).toBe('overview');
    expect(adminView('people ')).toBe('overview');
  });

  it('keeps a known section', () => {
    for (const view of ADMIN_VIEWS) expect(adminView(view)).toBe(view);
  });
});
