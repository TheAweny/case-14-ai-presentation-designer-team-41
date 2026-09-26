import { describe, expect, it } from 'vitest';
import { isSettingsShortcut, settingsSection, withSettings } from './settings-url';

describe('settingsSection', () => {
  it('reads the section, with unknown values falling back to general', () => {
    expect(settingsSection(null)).toBeNull();
    expect(settingsSection(undefined)).toBeNull();
    expect(settingsSection('models')).toBe('models');
    expect(settingsSection('general')).toBe('general');
    expect(settingsSection('billing')).toBe('general');
  });
});

describe('withSettings', () => {
  it('opens a section and keeps the rest of the address', () => {
    expect(withSettings('/decks/d1?slide=s2#top', 'models')).toBe(
      '/decks/d1?slide=s2&settings=models#top',
    );
    expect(withSettings('http://localhost:3000/?settings=general', 'models')).toBe(
      '/?settings=models',
    );
  });

  it('closes by dropping only the settings parameter', () => {
    expect(withSettings('/projects/p1?tab=templates&settings=models', null)).toBe(
      '/projects/p1?tab=templates',
    );
    expect(withSettings('/?settings=models', null)).toBe('/');
  });
});

describe('isSettingsShortcut', () => {
  const key = (extra: Partial<Parameters<typeof isSettingsShortcut>[0]>) => ({
    code: 'Comma',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...extra,
  });

  it('is Ctrl or Cmd with the comma key, in any layout', () => {
    expect(isSettingsShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(isSettingsShortcut(key({ metaKey: true }))).toBe(true);
  });

  it('is not the bare comma or Ctrl+Shift+, (smaller text)', () => {
    expect(isSettingsShortcut(key({}))).toBe(false);
    expect(isSettingsShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isSettingsShortcut(key({ ctrlKey: true, code: 'Period' }))).toBe(false);
  });
});
