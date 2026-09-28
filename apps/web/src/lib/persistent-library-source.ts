import { apiFetch, publicApiUrl } from './api';
import { decodeGeneratedDeck } from './http-generation';
import { designSystemSchema, templateIrSchema } from '@lct/contracts';
import type { LibrarySource, ProjectSummary, TemplateSummary } from './library-source';
import { templateLayoutsFromIr } from './template-profile';
import type { ProjectAppearance } from './project-appearance';
import { DeckNotFoundError } from './deck-source';
import {
  ProjectNotFoundError,
  TemplateNotFoundError,
  InvalidDeckPatchError,
  DECK_TITLE_MAX_LENGTH,
} from './library-source';

interface StoredTemplate {
  readonly fileId: string;
  readonly fileName?: string;
  readonly name?: string;
  readonly shared?: boolean;
  readonly mine?: boolean;
  readonly createdAt?: string;
  readonly size?: number;
  readonly profile?: { designSystem?: unknown; templateIr?: unknown; previewDataUrl?: unknown };
}

interface StoredProject {
  readonly projectId: string;
  readonly name: string;
  readonly appearance: ProjectAppearance;
  readonly templateIds?: readonly string[];
  readonly updatedAt?: string;
  readonly deckCount?: number;
  readonly pinnedAt?: string | null;
}

function templateOf(row: StoredTemplate): TemplateSummary {
  const ir = templateIrSchema.parse(row.profile?.templateIr);
  return {
    templateId: row.fileId,
    fileName: row.name ?? row.fileName ?? 'Шаблон.pptx',
    shared: row.shared ?? false,
    mine: row.mine ?? true,
    importedAt: (row.createdAt && Date.parse(row.createdAt)) || Date.now(),
    layouts: templateLayoutsFromIr(ir),
    designSystem: designSystemSchema.parse(row.profile?.designSystem),
    templateIr: ir,
    previewDataUrl:
      typeof row.profile?.previewDataUrl === 'string' ? row.profile.previewDataUrl : undefined,
  };
}

export function createPersistentLibrarySource(fallback: LibrarySource): LibrarySource {
  const request = async (path: string, init?: RequestInit) => {
    const response = await apiFetch(path, init);
    if (!response.ok) throw new Error(`Library API failed: ${response.status}`);
    return response.status === 204 ? undefined : response.json();
  };
  const templates = async () => {
    const rows = (await request('/files/templates')) as StoredTemplate[];
    return rows.map(templateOf);
  };
  return {
    ...fallback,
    async deleteDeck(deckId) {
      await request('/generation/' + encodeURIComponent(deckId), { method: 'DELETE' });
    },
    async updateDeck(deckId, patch) {
      if (
        patch.title !== undefined &&
        (!patch.title.trim() || patch.title.trim().length > DECK_TITLE_MAX_LENGTH)
      )
        throw new InvalidDeckPatchError('title');
      if (patch.projectId !== undefined && patch.projectId !== null)
        await this.getProject(patch.projectId);
      await request('/generation/' + encodeURIComponent(deckId), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const deck = (await this.listDecks()).find((item) => item.deckId === deckId);
      if (!deck) throw new DeckNotFoundError(deckId);
      return deck;
    },
    async deleteProject(projectId) {
      return request('/library/projects/' + encodeURIComponent(projectId), { method: 'DELETE' });
    },
    async listDecks(filter) {
      const rows = (await request('/generation')) as {
        deck: unknown;
        metadata: { projectId: string | null; templateId: string; updatedAt: number };
      }[];
      return rows.flatMap((row) => {
        const deck = decodeGeneratedDeck(row.deck);
        const cover = deck.slides[0];
        if (
          !cover ||
          (filter && 'projectId' in filter && row.metadata.projectId !== filter.projectId)
        )
          return [];
        return [
          {
            deckId: deck.deckId,
            title: deck.title,
            projectId: row.metadata.projectId,
            templateId: row.metadata.templateId,
            updatedAt: row.metadata.updatedAt,
            slideCount: deck.slides.length,
            slideSize: deck.slideSize,
            cover,
            coverPreviewUrl:
              deck.coverPreviewUrl ??
              publicApiUrl(`/generation/${encodeURIComponent(deck.deckId)}/artifacts/slide-1.png`),
            auditFindings: null,
          },
        ];
      });
    },
    async listTemplates() {
      return templates();
    },
    async updateTemplate(templateId, patch) {
      const row = (await request(`/files/templates/${encodeURIComponent(templateId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      }).catch((error: unknown) => {
        if (String(error).includes('404')) throw new TemplateNotFoundError(templateId);
        throw error;
      })) as StoredTemplate;
      return templateOf(row);
    },
    async deleteTemplate(templateId) {
      await request(`/files/templates/${encodeURIComponent(templateId)}`, {
        method: 'DELETE',
      }).catch((error: unknown) => {
        if (String(error).includes('404')) throw new TemplateNotFoundError(templateId);
        throw error;
      });
    },
    async getTemplate(templateId) {
      return (
        (await templates()).find((item) => item.templateId === templateId) ??
        fallback.getTemplate(templateId)
      );
    },
    async listProjects() {
      const rows = (await request('/library/projects')) as StoredProject[];
      const all = await templates();
      return rows.map((row): ProjectSummary => ({
        projectId: row.projectId,
        name: row.name,
        appearance: row.appearance,
        templates: (row.templateIds ?? []).flatMap((id) =>
          all.filter((template) => template.templateId === id),
        ),
        deckCount: row.deckCount ?? 0,
        updatedAt: Date.parse(String(row.updatedAt)) || Date.now(),
        pinned: row.pinnedAt != null,
        pinnedAt: row.pinnedAt == null ? null : Date.parse(row.pinnedAt),
      }));
    },
    async getProject(projectId) {
      const project = (await this.listProjects()).find((item) => item.projectId === projectId);
      if (!project) throw new ProjectNotFoundError(projectId);
      return project;
    },
    async createProject(input) {
      const created = await request('/library/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      const project = (await this.listProjects()).find(
        (item) => item.projectId === created.projectId,
      );
      if (!project) throw new Error('Created project not found.');
      return project;
    },
    async updateProject(projectId, patch) {
      await request(`/library/projects/${encodeURIComponent(projectId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const project = (await this.listProjects()).find((item) => item.projectId === projectId);
      if (!project) throw new Error('Project not found after update.');
      return project;
    },
    async attachTemplate(projectId, templateId) {
      await request(`/library/projects/${projectId}/templates/${templateId}`, { method: 'POST' });
      const project = (await this.listProjects()).find((item) => item.projectId === projectId);
      if (!project) throw new Error('Project not found after update.');
      return project;
    },
    async detachTemplate(projectId, templateId) {
      await request(`/library/projects/${projectId}/templates/${templateId}`, { method: 'DELETE' });
      const project = (await this.listProjects()).find((item) => item.projectId === projectId);
      if (!project) throw new Error('Project not found after update.');
      return project;
    },
  };
}
