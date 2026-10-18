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
  StreamableFile,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiConsumes,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
} from '@nestjs/swagger';
import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Pool } from 'pg';
import { EngineClient } from '@lct/engine-client';
import { decodeMultipartFilename } from './filename.js';
import { templateUploadError } from './template-upload-error.js';
import { visibleFile } from './template-visibility.js';
import { CurrentAccount } from '../accounts/account.guard.js';
import type { Account } from '../accounts/account-rules.js';
import { ApiAccountRoutes, ApiErrors, ApiFile, ApiJsonBody } from '../docs/decorators.js';
import { storedFileSchema, templatePatchSchema } from '../docs/schemas.js';

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

const UPLOAD_BODY = {
  schema: {
    type: 'object',
    required: ['file'],
    properties: { file: { type: 'string', format: 'binary' } },
  },
};

const TEMPLATE_EXAMPLE = {
  fileId: '11d8fefa-d032-4a95-84e5-77efd69569c2',
  kind: 'template',
  fileName: 'VK Tech шаблон.pptx',
  name: 'VK Tech шаблон',
  size: 2483112,
  sha256: '9f2c4e1a7b3d5f6081c2e4a6b8d0f1e3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5',
  shared: true,
  mine: false,
  createdAt: '2026-10-14T08:30:00.000Z',
};

/**
 * Uploads of the template `.pptx` and of the content pack, plus downloads of run artifacts.
 * Storage lives in `runs/`; template uploads are parsed by the Python engine before the response.
 */
@Controller('files')
@ApiAccountRoutes('files')
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
  @ApiOperation({
    summary: 'Загрузить шаблон',
    description:
      'Принимает `.pptx` или `.potx`. Движок разбирает файл до ответа: в `profile` — палитра, шрифты, сетка и макеты шаблона.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody(UPLOAD_BODY)
  @ApiAcceptedResponse({
    standardSchema: storedFileSchema,
    example: { ...TEMPLATE_EXAMPLE, shared: false, mine: true },
  })
  @ApiErrors(400, 422, 503, 504)
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
  @ApiOperation({
    summary: 'Загрузить материалы',
    description:
      'Текст или таблица для колоды: `.txt`, `.md`, `.docx`, `.pdf`, `.csv`, `.tsv`, `.xlsx`.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody(UPLOAD_BODY)
  @ApiAcceptedResponse({
    standardSchema: storedFileSchema,
    example: {
      fileId: '3c9e1b7a-5d2f-4e8a-b6c4-0f1a2d3e4b5c',
      kind: 'content',
      fileName: 'выручка-2026.xlsx',
      size: 18234,
      sha256: '4a71c3e5f7a9b1d3e5f7a9c1b3d5e7f9a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1',
    },
  })
  @ApiErrors(400)
  async uploadContent(
    @CurrentAccount() account: Account,
    @UploadedFile() file?: UploadedFile,
  ): Promise<StoredFile> {
    if (!file) throw new BadRequestException('Field file is required.');
    const fileName = decodeMultipartFilename(file.originalname);
    const extension = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
    const accepted = ['.txt', '.md', '.docx', '.pdf', '.csv', '.tsv', '.xlsx'];
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
  @ApiOperation({
    summary: 'Все файлы аккаунта',
    description: 'Шаблоны и материалы, новые сверху.',
  })
  @ApiOkResponse({ standardSchema: z.array(storedFileSchema) })
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
  @ApiOperation({ summary: 'Шаблоны', description: 'Свои и открытые всем администратором.' })
  @ApiOkResponse({ standardSchema: z.array(storedFileSchema), example: [TEMPLATE_EXAMPLE] })
  async listTemplates(@CurrentAccount() account: Account): Promise<readonly StoredFile[]> {
    const result = await this.pool.query<TemplateRow>(
      `SELECT ${TEMPLATE_COLUMNS} FROM stored_files
       WHERE kind = 'template' AND ${visibleFile(1)} ORDER BY created_at DESC`,
      [account.id],
    );
    return result.rows.map((row) => templateOf(row, account));
  }

  /**
   * A picture of one slide of a template the account may use, drawn when the template was
   * prepared. It is asked for by its number, however the renderer padded the file name.
   */
  @Get('templates/:id/previews/:name')
  @ApiOperation({
    summary: 'Превью слайда шаблона',
    description: 'Нарисовано при подготовке шаблона.',
  })
  @ApiParam({ name: 'id', example: TEMPLATE_EXAMPLE.fileId })
  @ApiParam({ name: 'name', example: 'slide-3.png' })
  @ApiFile('PNG слайда.', 'image/png')
  @ApiErrors(404)
  async templatePreview(
    @Param('id') id: string,
    @Param('name') name: string,
    @CurrentAccount() account: Account,
  ): Promise<StreamableFile> {
    const number = /^slide-(\d+)\.png$/.exec(name)?.[1];
    if (!/^[0-9a-f-]{36}$/i.test(id) || number === undefined)
      throw new NotFoundException('Preview not found.');
    const result = await this.pool.query<{ storage_path: string }>(
      `SELECT storage_path FROM stored_files
       WHERE id = $1 AND kind = 'template' AND ${visibleFile(2)}`,
      [id, account.id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Preview not found.');
    const directory = join(dirname(row.storage_path), 'previews');
    const found = (await readdir(directory).catch(() => [])).find(
      (file) => /^slide-\d+\.png$/.test(file) && Number(/\d+/.exec(file)?.[0]) === Number(number),
    );
    if (!found) throw new NotFoundException('Preview not found.');
    return new StreamableFile(createReadStream(join(directory, found)), {
      type: 'image/png',
    });
  }

  /**
   * Rename a template, or share it with everyone. The owner renames; sharing is the
   * administrator's, who may also rename a shared template.
   */
  @Patch('templates/:id')
  @ApiOperation({
    summary: 'Переименовать или открыть шаблон всем',
    description: 'Переименовывает владелец; `shared` меняет только администратор.',
  })
  @ApiParam({ name: 'id', example: TEMPLATE_EXAMPLE.fileId })
  @ApiJsonBody(templatePatchSchema, {
    Переименовать: { name: 'VK Tech — квартальный отчёт' },
    'Открыть всем': { shared: true },
  })
  @ApiOkResponse({ standardSchema: storedFileSchema, example: TEMPLATE_EXAMPLE })
  @ApiErrors(400, 404)
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
  @ApiOperation({
    summary: 'Убрать шаблон из библиотеки',
    description: 'Файл остаётся: колоды на этом шаблоне открываются и экспортируются.',
  })
  @ApiParam({ name: 'id', example: TEMPLATE_EXAMPLE.fileId })
  @ApiNoContentResponse({ description: 'Шаблон убран.' })
  @ApiErrors(404)
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
