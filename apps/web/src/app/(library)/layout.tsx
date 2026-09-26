import type { ReactNode } from 'react';
import { LibraryNotices } from '@/components/library/library-notices';
import { LibraryProjects } from '@/components/library/library-projects';
import { LibrarySidebar } from '@/components/library/library-sidebar';
import { librarySource } from '@/mocks/sources';

/** Главное меню: сайдбар с проектами слева, страница справа. Редактор живёт вне этой группы. */
export default async function LibraryLayout({ children }: { children: ReactNode }) {
  const projects = (await librarySource.listProjects()).map(
    ({ projectId, name, appearance, deckCount }) => ({ projectId, name, appearance, deckCount }),
  );
  return (
    // Уведомления меню объектов — одни на весь раздел: сайдбар и страница делят строку внизу.
    // Проекты раздела — и сайдбару, и меню презентаций на страницах (подменю переноса).
    <LibraryNotices>
      <LibraryProjects projects={projects}>
        <div className="flex min-h-dvh flex-col bg-background text-foreground md:h-dvh md:flex-row">
          <LibrarySidebar projects={projects} />
          <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
        </div>
      </LibraryProjects>
    </LibraryNotices>
  );
}
