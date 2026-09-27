import {
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
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { join, resolve } from 'node:path';
import { LibraryMetadata } from '../generation/library-metadata.js';

interface ProjectInput {
  readonly name?: unknown;
  readonly appearance?: unknown;
}

@Controller('library')
export class LibraryController {
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });
  private readonly library = new LibraryMetadata(
    resolve(process.env.RUNS_DIR ?? join(process.cwd(), 'runs')),
  );

  @Get('projects')
  async listProjects(): Promise<readonly unknown[]> {
    const result = await this.pool.query(
      `SELECT p.id AS "projectId", p.name, p.appearance, p.created_at AS "createdAt", p.updated_at AS "updatedAt",
              COALESCE(array_agg(pt.template_id) FILTER (WHERE pt.template_id IS NOT NULL), '{}') AS "templateIds"
       FROM library_projects p LEFT JOIN library_project_templates pt ON pt.project_id = p.id
       GROUP BY p.id ORDER BY p.updated_at DESC`,
    );
    const completed = new Set(
      (await this.pool.query<{ id: string }>("SELECT id FROM runs WHERE state = 'done'")).rows.map(
        (row) => row.id,
      ),
    );
    const entries = await this.library.entries();
    return result.rows.map((row) => ({
      ...row,
      deckCount: entries.filter(
        (entry) =>
          completed.has(entry.id) &&
          !entry.metadata.deletedAt &&
          entry.metadata.projectId === row.projectId,
      ).length,
    }));
  }

  @Post('projects')
  async createProject(@Body() body: ProjectInput): Promise<unknown> {
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      throw new BadRequestException('Project name is required.');
    }
    const projectId = randomUUID();
    const result = await this.pool.query(
      `INSERT INTO library_projects(id, name, appearance) VALUES ($1, $2, $3::jsonb)
       RETURNING id AS "projectId", name, appearance, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        projectId,
        body.name.trim(),
        JSON.stringify(body.appearance ?? { icon: 'folder', color: 'blue' }),
      ],
    );
    return result.rows[0];
  }

  @Patch('projects/:id')
  async updateProject(@Param('id') id: string, @Body() body: ProjectInput): Promise<unknown> {
    const result = await this.pool.query(
      `UPDATE library_projects SET
         name = COALESCE($2, name), appearance = COALESCE($3::jsonb, appearance), updated_at = now()
       WHERE id = $1
       RETURNING id AS "projectId", name, appearance, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        id,
        typeof body.name === 'string' ? body.name.trim() : null,
        body.appearance ? JSON.stringify(body.appearance) : null,
      ],
    );
    if (result.rowCount === 0) throw new NotFoundException('Project not found.');
    return result.rows[0];
  }

  @Delete('projects/:id')
  async deleteProject(@Param('id') id: string): Promise<{ deletedDecks: number }> {
    if (!(await this.pool.query('SELECT id FROM library_projects WHERE id = $1', [id])).rowCount)
      throw new NotFoundException('Project not found.');
    const entries = (await this.library.entries()).filter(
      (entry) => entry.metadata.projectId === id && !entry.metadata.deletedAt,
    );
    await Promise.all(entries.map((entry) => this.library.remove(entry.id)));
    const result = await this.pool.query('DELETE FROM library_projects WHERE id = $1', [id]);
    if (result.rowCount === 0) throw new NotFoundException('Project not found.');
    return { deletedDecks: entries.length };
  }

  @Post('projects/:projectId/templates/:templateId')
  async attachTemplate(
    @Param('projectId') projectId: string,
    @Param('templateId') templateId: string,
  ) {
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
  async detachTemplate(
    @Param('projectId') projectId: string,
    @Param('templateId') templateId: string,
  ) {
    await this.pool.query(
      'DELETE FROM library_project_templates WHERE project_id = $1 AND template_id = $2',
      [projectId, templateId],
    );
    return { ok: true };
  }
}
