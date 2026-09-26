'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadIgnores, saveIgnores } from '@/lib/audit-ignores';
import { browserDraftStore } from '@/lib/draft-storage';

export interface AuditIgnores {
  readonly ignored: ReadonlySet<string>;
  readonly ignore: (issueId: string) => void;
  readonly restore: (issueId: string) => void;
}

/**
 * Пропущенные находки колоды: читаются из браузера при открытии и пишутся после каждого
 * «Пропустить» и «Вернуть». Нет хранилища (сервер, старый приватный режим) — живут до закрытия
 * вкладки.
 */
export function useAuditIgnores(deckId: string): AuditIgnores {
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set());
  const store = useRef(typeof indexedDB === 'undefined' ? null : browserDraftStore());

  useEffect(() => {
    let alive = true;
    const current = store.current;
    if (!current) return;
    void loadIgnores(current, deckId).then(
      (ids) => {
        if (alive && ids.length > 0) setIgnored(new Set(ids));
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [deckId]);

  const change = useCallback(
    (update: (ids: Set<string>) => void) => {
      setIgnored((current) => {
        const next = new Set(current);
        update(next);
        const target = store.current;
        if (target) void saveIgnores(target, deckId, [...next]).catch(() => undefined);
        return next;
      });
    },
    [deckId],
  );

  const ignore = useCallback((id: string) => change((ids) => ids.add(id)), [change]);
  const restore = useCallback(
    (id: string) =>
      change((ids) => {
        ids.delete(id);
      }),
    [change],
  );

  return { ignored, ignore, restore };
}
