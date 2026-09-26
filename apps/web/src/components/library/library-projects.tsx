'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { ProjectSummary } from '@/lib/library-source';

/** Что меню объектов знает о проекте: чтобы назвать его и нарисовать его иконку. */
export type LibraryProject = Pick<ProjectSummary, 'projectId' | 'name' | 'appearance'>;

const ProjectsContext = createContext<readonly LibraryProject[]>([]);

/**
 * Проекты раздела для меню объектов: подменю «Переместить в проект» есть у каждой карточки и
 * строки презентации, а страницы, которые их рисуют, проекты целиком не грузят. Список уже
 * есть у раздела (его показывает сайдбар), поэтому раздел и раздаёт его вниз — без пропсов
 * через каждую страницу.
 */
export function LibraryProjects({
  projects,
  children,
}: {
  projects: readonly LibraryProject[];
  children: ReactNode;
}) {
  return <ProjectsContext value={projects}>{children}</ProjectsContext>;
}

/** Проекты раздела в порядке сайдбара. Вне `LibraryProjects` — пустой список. */
export function useLibraryProjects(): readonly LibraryProject[] {
  return useContext(ProjectsContext);
}
