import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { EngineClient } from '@lct/engine-client';
import { decodeMultipartFilename } from './filename.js';
import { templateUploadError } from './template-upload-error.js';
import { visibleFile } from './template-visibility.js';
import { CurrentAccount } from '../accounts/account.guard.js';
import type { Account } from '../accounts/account-rules.js';

interface UploadedFile {
  readonly originalname: string;
  readonly size: number;
  readonly buffer: Buffer;
}

/** Reference to a file stored under the run directory. */
export interface StoredFile {
  readonly fileId: string;
  readonly kind: 'template' | 'content' | 'artifact';
  readonly fileName?: string;
  readonly size?: number;
  readonly sha256?: string;
  readonly profile?: unknown;
  /** Templates: the name shown in the library, the file name until someone renames it. */
  readonly name?: string;
  /** Templates: shared by an administrator with every account. */
  readonly shared?: boolean;
  /** Templates: the account asking uploaded it and may rename and delete it. */
  readonly mine?: boolean;
  readonly createdAt?: string;
}

const TEMPLATE_NAME_MAX_LENGTH = 200;

/**
 * Uploads of the template `.pptx` and of the content pack, plus downloads of run artifacts.
 * Storage lives in `runs/`; template uploads are parsed by the Python engine before the response.
 */
@Controller('files')
export class FilesController implements OnApplicationShutdown {
  private readonly logger = new Logger(FilesController.name);
  private readonly root = resolve(process.env.RUNS_DIR ?? join(process.cwd(), 'runs'));
  private readonly engine = new EngineClient({
    baseUrl: process.env.ENGINE_URL ?? 'http://localhost:8000',
  });
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });

  @Post('template')
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file'))
  async uploadTemplate(
    @CurrentAccount() account: Account,
    @UploadedFile() file?: UploadedFile,
  ): Promise<StoredFile> {
    if (!file) throw new BadRequestException('Field file is required.');
    const fileName = decodeMultipartFilename(file.originalname);
    if (!['.pptx', '.potx'].includes(fileName.toLowerCase().slice(fileName.lastIndexOf('.')))) {
      throw new BadRequestException('Only .pptx and .potx templates are accepted.');
    }
    if (file.size === 0) throw new BadRequestException('The uploaded template is empty.');
    const fileId = randomUUID();
    const directory = join(this.root, 'templates', fileId);
    await mkdir(directory, { recursive: true });
    const templatePath = join(directory, fileName);
    await writeFile(templatePath, file.buffer);
    const profile = await this.engine.parseTemplateProfile(templatePath).catch((error: unknown) => {
      this.logger.error('Template profile request failed', error);
      throw templateUploadError(error);
    });
    await this.pool.query(
      `INSERT INTO stored_files
        (id, kind, file_name, storage_path, size_bytes, sha256, profile, owner_id)
       VALUES ($1, 'template', $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        fileId,
        fileName,
        templatePath,
        file.size,
        createHash('sha256').update(file.buffer).digest('hex'),
        JSON.stringify(profile),
        account.id,
      ],
    );
    return {
      fileId,
      kind: 'template',
      fileName,
      name: fileName,
      shared: false,
      mine: true,
      size: file.size,
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
      profile,
    };
  }

  @Post('content')
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file'))
  async uploadContent(
    @CurrentAccount() account: Account,
    @UploadedFile() file?: UploadedFile,
  ): Promise<StoredFile> {
    if (!file) throw new BadRequestException('Field file is required.');
    const fileName = decodeMultipartFilename(file.originalname);
    const extension = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
    const accepted = ['.txt', '.md', '.docx', '.csv', '.tsv', '.xlsx'];
    if (!accepted.includes(extension))
      throw new BadRequestException('Unsupported content file type.');
    if (file.size === 0) throw new BadRequestException('The uploaded content file is empty.');
    const fileId = randomUUID();
    const directory = join(this.root, 'content', fileId);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, fileName), file.buffer);
    await this.pool.query(
      `INSERT INTO stored_files
        (id, kind, file_name, storage_path, size_bytes, sha256, owner_id)
       VALUES ($1, 'content', $2, $3, $4, $5, $6)`,
      [
        fileId,
        fileName,
        join(directory, fileName),
        file.size,
        createHash('sha256').update(file.buffer).digest('hex'),
        account.id,
      ],
    );
    return {
      fileId,
      kind: 'content',
      fileName,
      size: file.size,
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
    };
  }

  @Get()
  async list(@CurrentAccount() account: Account): Promise<readonly StoredFile[]> {
    const result = await this.pool.query<{
      id: string;
      kind: StoredFile['kind'];
      file_name: string;
      size_bytes: string;
      sha256: string;
      profile: unknown;
    }>(
      `SELECT id, kind, file_name, size_bytes, sha256, profile
       FROM stored_files WHERE ${visibleFile(1)} ORDER BY created_at DESC`,
      [account.id],
    );
    return result.rows.map((row) => ({
      fileId: row.id,
      kind: row.kind,
      fileName: row.file_name,
      size: Number(row.size_bytes),
      sha256: row.sha256,
      ...(row.profile === null ? {} : { profile: row.profile }),
    }));
  }

  /** The templates the account may use: its own and those shared with everyone. */
  @Get('templates')
  async listTemplates(@CurrentAccount() account: Account): Promise<readonly StoredFile[]> {
    const result = await this.pool.query<TemplateRow>(
      `SELECT ${TEMPLATE_COLUMNS} FROM stored_files
       WHERE kind = 'template' AND ${visibleFile(1)} ORDER BY created_at DESC`,
      [account.id],
    );
    return result.rows.map((row) => templateOf(row, account));
  }

  /**
   * Rename a template, or share it with everyone. The owner renames; sharing is the
   * administrator's, who may also rename a shared template.
   */
  @Patch('templates/:id')
  async updateTemplate(
    @Param('id') id: string,
    @Body() body: { name?: unknown; shared?: unknown },
    @CurrentAccount() account: Account,
  ): Promise<StoredFile> {
    const row = await this.visibleTemplate(id, account);
    if (row.owner_id !== account.id && account.role !== 'admin') {
      throw new ForbiddenException('Only the owner or an administrator can change a template.');
    }
    if (body.shared !== undefined) {
      if (typeof body.shared !== 'boolean') {
        throw new BadRequestException('shared must be a boolean.');
      }
      if (account.role !== 'admin') {
        throw new ForbiddenException('Only an administrator can share a template.');
      }
    }
    let name: string | null = null;
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim() === '') {
        throw new BadRequestException('Template name is required.');
      }
      name = body.name.trim();
      if (name.length > TEMPLATE_NAME_MAX_LENGTH) {
        throw new BadRequestException('Template name is too long.');
      }
    }
    const result = await this.pool.query<TemplateRow>(
      `UPDATE stored_files SET display_name = COALESCE($2, display_name),
              shared = COALESCE($3, shared)
       WHERE id = $1 RETURNING ${TEMPLATE_COLUMNS}`,
      [id, name, typeof body.shared === 'boolean' ? body.shared : null],
    );
    const updated = result.rows[0];
    if (!updated) throw new NotFoundException('Template not found.');
    return templateOf(updated, account);
  }

  /**
   * Take a template out of the library. Its file stays: decks laid out with it still open and
   * export. It leaves the projects it was attached to.
   */
  @Delete('templates/:id')
  @HttpCode(204)
  async deleteTemplate(@Param('id') id: string, @CurrentAccount() account: Account): Promise<void> {
    const row = await this.visibleTemplate(id, account);
    if (row.owner_id !== account.id && account.role !== 'admin') {
      throw new ForbiddenException('Only the owner or an administrator can delete a template.');
    }
    await this.pool.query('UPDATE stored_files SET deleted_at = now() WHERE id = $1', [id]);
    await this.pool.query('DELETE FROM library_project_templates WHERE template_id = $1', [id]);
  }

  private async visibleTemplate(id: string, account: Account): Promise<TemplateRow> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('Template not found.');
    const result = await this.pool.query<TemplateRow>(
      `SELECT ${TEMPLATE_COLUMNS} FROM stored_files
       WHERE id = $1 AND kind = 'template' AND ${visibleFile(2)}`,
      [id, account.id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Template not found.');
    return row;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

interface TemplateRow {
  readonly id: string;
  readonly file_name: string;
  readonly display_name: string | null;
  readonly size_bytes: string;
  readonly sha256: string;
  readonly profile: unknown;
  readonly owner_id: string | null;
  readonly shared: boolean;
  readonly created_at: Date;
}

const TEMPLATE_COLUMNS =
  'id, file_name, display_name, size_bytes, sha256, profile, owner_id, shared, created_at';

function templateOf(row: TemplateRow, account: Account): StoredFile {
  return {
    fileId: row.id,
    kind: 'template',
    fileName: row.file_name,
    name: row.display_name ?? row.file_name,
    size: Number(row.size_bytes),
    sha256: row.sha256,
    profile: row.profile,
    shared: row.shared,
    mine: row.owner_id === account.id,
    createdAt: row.created_at.toISOString(),
  };
}
