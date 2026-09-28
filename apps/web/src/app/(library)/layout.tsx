import type { ReactNode } from 'react';
import { getNow } from 'next-intl/server';
import { LibraryNotices } from '@/components/library/library-notices';
import { LibraryProjects } from '@/components/library/library-projects';
import { LibrarySidebar } from '@/components/library/library-sidebar';
import { librarySource } from '@/mocks/sources';
import { requireAccount } from '../auth-session';

/**
 * Главное меню: слева история и закреплённые проекты, справа страница. Редактор живёт вне
 * этой группы. День истории считается в момент запроса, чтобы подписи не разъехались при гидрации.
 */
export default async function LibraryLayout({ children }: { children: ReactNode }) {
  const account = await requireAccount();
  const [listedProjects, listedDecks, now] = await Promise.all([
    librarySource.listProjects(),
    librarySource.listDecks(),
    getNow(),
  ]);
  const projects = listedProjects.map(
    ({ projectId, name, appearance, deckCount, pinned, pinnedAt }) => ({
      projectId,
      name,
      appearance,
      deckCount,
      pinned,
      pinnedAt,
    }),
  );
  const decks = listedDecks.map(({ deckId, title, projectId, updatedAt }) => ({
    deckId,
    title,
    projectId,
    updatedAt,
  }));
  return (
    // Уведомления меню объектов — одни на весь раздел: сайдбар и страница делят строку внизу.
    // Проекты раздела — и сайдбару, и меню презентаций на страницах (подменю переноса).
    <LibraryNotices>
      <LibraryProjects projects={projects}>
        <div className="flex min-h-dvh flex-col bg-background text-foreground md:h-dvh md:flex-row">
          <LibrarySidebar projects={projects} decks={decks} now={now.getTime()} account={account} />
          {/* Прокручивается сам только на широком экране; на телефоне — документ, и у страниц работает sticky. */}
          <main className="min-w-0 flex-1 md:overflow-y-auto">{children}</main>
        </div>
      </LibraryProjects>
    </LibraryNotices>
  );
}
