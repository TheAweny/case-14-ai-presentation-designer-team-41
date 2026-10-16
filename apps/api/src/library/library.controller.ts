import {
  applyDecorators,
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam } from '@nestjs/swagger';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { join, resolve } from 'node:path';
import { CurrentAccount } from '../accounts/account.guard.js';
import type { Account } from '../accounts/account-rules.js';
import { buildOf, LibraryMetadata } from '../generation/library-metadata.js';
import { visibleFile } from '../files/template-visibility.js';
import { ApiAccountRoutes, ApiErrors, ApiJsonBody } from '../docs/decorators.js';
import {
  listedProjectSchema,
  okSchema,
  projectInputSchema,
  projectSchema,
} from '../docs/schemas.js';

const PROJECT_ID = '2e4a6c8e-0b1d-4f3a-8c5e-7a9b1d3f5e70';
const PROJECT_EXAMPLE = {
  projectId: PROJECT_ID,
  name: 'Совет директоров',
  appearance: { icon: 'folder', color: 'blue' },
  createdAt: '2026-10-10T12:00:00.000Z',
  updatedAt: '2026-10-16T10:04:12.000Z',
  pinnedAt: null,
};
const projectParam = ApiParam({ name: 'id', example: PROJECT_ID });
const templateLink = [
  ApiParam({ name: 'projectId', example: PROJECT_ID }),
  ApiParam({ name: 'templateId', example: '11d8fefa-d032-4a95-84e5-77efd69569c2' }),
];

interface ProjectInput {
  readonly name?: unknown;
  readonly appearance?: unknown;
  readonly pinned?: unknown;
}

@Controller('library')
@ApiAccountRoutes('library')
export class LibraryController {
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });
  private readonly library = new LibraryMetadata(
    resolve(process.env.RUNS_DIR ?? join(process.cwd(), 'runs')),
  );

  /** Projects belong to one account; every route answers only for the owner's. */
  @Get('projects')
  @ApiOperation({ summary: 'Проекты', description: 'С шаблонами проекта и числом колод.' })
  @ApiOkResponse({
    standardSchema: z.array(listedProjectSchema),
    example: [{ ...PROJECT_EXAMPLE, templateIds: [], deckCount: 3 }],
  })
  async listProjects(@CurrentAccount() account: Account): Promise<readonly unknown[]> {
    const result = await this.pool.query(
      `SELECT p.id AS "projectId", p.name, p.appearance, p.created_at AS "createdAt", p.updated_at AS "updatedAt",
              p.pinned_at AS "pinnedAt",
              COALESCE(array_agg(pt.template_id) FILTER (WHERE pt.template_id IS NOT NULL), '{}') AS "templateIds"
       FROM library_projects p LEFT JOIN library_project_templates pt ON pt.project_id = p.id
       WHERE p.owner_id = $1
       GROUP BY p.id ORDER BY p.updated_at DESC`,
      [account.id],
    );
    const completed = new Set(
      (await this.pool.query<{ id: string }>("SELECT id FROM runs WHERE state = 'done'")).rows.map(
        (row) => row.id,
      ),
    );
    const entries = await this.library.entries();
    return result.rows.map((row) => ({
      ...row,
      // A build counts once, however many of its variants are done.
      deckCount: new Set(
        entries
          .filter(
            (entry) =>
              completed.has(entry.id) &&
              !entry.metadata.deletedAt &&
              entry.metadata.ownerId === account.id &&
              entry.metadata.projectId === row.projectId,
          )
          .map(buildOf),
      ).size,
    }));
  }

  @Post('projects')
  @ApiOperation({ summary: 'Создать проект' })
  @ApiJsonBody(projectInputSchema, {
    'Новый проект': { name: 'Совет директоров', appearance: { icon: 'folder', color: 'blue' } },
  })
  @ApiCreatedResponse({ standardSchema: projectSchema, example: PROJECT_EXAMPLE })
  @ApiErrors(400)
  async createProject(
    @Body() body: ProjectInput,
    @CurrentAccount() account: Account,
  ): Promise<unknown> {
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      throw new BadRequestException('Project name is required.');
    }
    const projectId = randomUUID();
    const result = await this.pool.query(
      `INSERT INTO library_projects(id, name, appearance, owner_id) VALUES ($1, $2, $3::jsonb, $4)
       RETURNING id AS "projectId", name, appearance, created_at AS "createdAt", updated_at AS "updatedAt",
                 pinned_at AS "pinnedAt"`,
      [
        projectId,
        body.name.trim(),
        JSON.stringify(body.appearance ?? { icon: 'folder', color: 'blue' }),
        account.id,
      ],
    );
    return result.rows[0];
  }

  @Patch('projects/:id')
  @ApiOperation({
    summary: 'Изменить проект',
    description: 'Имя, значок с цветом или закрепление в меню. Закрепление не двигает дату правки.',
  })
  @projectParam
  @ApiJsonBody(projectInputSchema, {
    Переименовать: { name: 'Совет директоров — Q4' },
    Закрепить: { pinned: true },
  })
  @ApiOkResponse({ standardSchema: projectSchema, example: PROJECT_EXAMPLE })
  @ApiErrors(400, 404)
  async updateProject(
    @Param('id') id: string,
    @Body() body: ProjectInput,
    @CurrentAccount() account: Account,
  ): Promise<unknown> {
    if (body.pinned !== undefined && typeof body.pinned !== 'boolean') {
      throw new BadRequestException('pinned must be a boolean.');
    }
    // Pinning keeps the moment of the first pin and does not count as an edit of the project.
    const result = await this.pool.query(
      `UPDATE library_projects SET
         name = COALESCE($2, name), appearance = COALESCE($3::jsonb, appearance),
         pinned_at = CASE WHEN $4::boolean IS NULL THEN pinned_at
                          WHEN $4::boolean THEN COALESCE(pinned_at, now()) ELSE NULL END,
         updated_at = CASE WHEN $2::text IS NULL AND $3::jsonb IS NULL THEN updated_at ELSE now() END
       WHERE id = $1 AND owner_id = $5
       RETURNING id AS "projectId", name, appearance, created_at AS "createdAt", updated_at AS "updatedAt",
                 pinned_at AS "pinnedAt"`,
      [
        id,
        typeof body.name === 'string' ? body.name.trim() : null,
        body.appearance ? JSON.stringify(body.appearance) : null,
        typeof body.pinned === 'boolean' ? body.pinned : null,
        account.id,
      ],
    );
    if (result.rowCount === 0) throw new NotFoundException('Project not found.');
    return result.rows[0];
  }

  @Delete('projects/:id')
  @ApiOperation({ summary: 'Удалить проект', description: 'Вместе с его колодами.' })
  @projectParam
  @ApiOkResponse({
    standardSchema: z.object({ deletedDecks: z.number().int() }),
    example: { deletedDecks: 3 },
  })
  @ApiErrors(404)
  async deleteProject(
    @Param('id') id: string,
    @CurrentAccount() account: Account,
  ): Promise<{ deletedDecks: number }> {
    await this.requireProject(id, account);
    const entries = (await this.library.entries()).filter(
      (entry) =>
        entry.metadata.projectId === id &&
        entry.metadata.ownerId === account.id &&
        !entry.metadata.deletedAt,
    );
    await Promise.all(entries.map((entry) => this.library.remove(entry.id)));
    const result = await this.pool.query(
      'DELETE FROM library_projects WHERE id = $1 AND owner_id = $2',
      [id, account.id],
    );
    if (result.rowCount === 0) throw new NotFoundException('Project not found.');
    return { deletedDecks: entries.length };
  }

  @Post('projects/:projectId/templates/:templateId')
  @ApiOperation({ summary: 'Добавить шаблон в проект' })
  @applyDecorators(...templateLink)
  @ApiCreatedResponse({ standardSchema: okSchema, example: { ok: true } })
  @ApiErrors(404)
  async attachTemplate(
    @Param('projectId') projectId: string,
    @Param('templateId') templateId: string,
    @CurrentAccount() account: Account,
  ) {
    await this.requireProject(projectId, account);
    const template = await this.pool.query(
      `SELECT id FROM stored_files WHERE id = $1 AND kind = 'template' AND ${visibleFile(2)}`,
      [templateId, account.id],
    );
    if (!template.rowCount) throw new NotFoundException('Template not found.');
    await this.pool.query(
      `INSERT INTO library_project_templates(project_id, template_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [projectId, templateId],
    );
    await this.pool.query('UPDATE library_projects SET updated_at = now() WHERE id = $1', [
      projectId,
    ]);
    return { ok: true };
  }

  @Delete('projects/:projectId/templates/:templateId')
  @ApiOperation({
    summary: 'Убрать шаблон из проекта',
    description: 'Сам шаблон остаётся в библиотеке.',
  })
  @applyDecorators(...templateLink)
  @ApiOkResponse({ standardSchema: okSchema, example: { ok: true } })
  @ApiErrors(404)
  async detachTemplate(
    @Param('projectId') projectId: string,
    @Param('templateId') templateId: string,
    @CurrentAccount() account: Account,
  ) {
    await this.requireProject(projectId, account);
    await this.pool.query(
      'DELETE FROM library_project_templates WHERE project_id = $1 AND template_id = $2',
      [projectId, templateId],
    );
    return { ok: true };
  }

  private async requireProject(id: string, account: Account): Promise<void> {
    const found = await this.pool.query(
      'SELECT id FROM library_projects WHERE id = $1 AND owner_id = $2',
      [id, account.id],
    );
    if (!found.rowCount) throw new NotFoundException('Project not found.');
  }
}
