import { describe, expect, it } from 'vitest';
import { templateMenuActions } from './template-menu';

describe('templateMenuActions', () => {
  it('keeps the original-file download on a shared template the account cannot change', () => {
    expect(templateMenuActions({ editable: false, canShare: false, shared: true })).toEqual([
      'download',
    ]);
  });

  it('adds rename and delete for the owner, and sharing only for an administrator', () => {
    expect(templateMenuActions({ editable: true, canShare: false, shared: false })).toEqual([
      'download',
      'rename',
      'delete',
    ]);
    expect(templateMenuActions({ editable: true, canShare: true, shared: true })).toEqual([
      'download',
      'rename',
      'unshare',
      'delete',
    ]);
    expect(templateMenuActions({ editable: true, canShare: true, shared: false })).toEqual([
      'download',
      'rename',
      'share',
      'delete',
    ]);
  });
});
