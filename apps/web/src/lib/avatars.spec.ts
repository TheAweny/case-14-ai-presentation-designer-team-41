import { describe, expect, it } from 'vitest';
import { AVATAR_PRESETS, avatarView, defaultAvatarIndex, presetAvatar } from './avatars';

describe('avatars', () => {
  it('gives one person the same mark every time', () => {
    const id = '7d13d387-09f4-4a51-bc66-a9b89095c8a6';
    expect(defaultAvatarIndex(id)).toBe(defaultAvatarIndex(id));
    expect(defaultAvatarIndex(id)).toBeGreaterThanOrEqual(0);
    expect(defaultAvatarIndex(id)).toBeLessThan(AVATAR_PRESETS);
  });

  it('spreads people over every mark', () => {
    const seen = new Set(
      Array.from({ length: 200 }, (_, at) =>
        defaultAvatarIndex(`00000000-0000-4000-8000-${String(at).padStart(12, '0')}`),
      ),
    );
    expect(seen.size).toBe(AVATAR_PRESETS);
  });

  it('shows the mark by id, a mark picked, or a photo', () => {
    const id = 'u-1';
    expect(avatarView(null, id)).toEqual({ kind: 'mark', index: defaultAvatarIndex(id) });
    expect(avatarView(presetAvatar(3), id)).toEqual({ kind: 'mark', index: 3 });
    expect(avatarView('data:image/webp;base64,UklGR', id)).toEqual({
      kind: 'image',
      src: 'data:image/webp;base64,UklGR',
    });
  });

  it('falls back to the mark by id for a value it does not know', () => {
    const own = { kind: 'mark', index: defaultAvatarIndex('u-1') };
    expect(avatarView('preset:42', 'u-1')).toEqual(own);
    expect(avatarView('javascript:alert(1)', 'u-1')).toEqual(own);
    expect(avatarView('data:image/svg+xml;base64,PHN2Zz4=', 'u-1')).toEqual(own);
  });
});
