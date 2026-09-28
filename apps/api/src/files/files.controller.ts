import {
  Controller,
  Get,
  HttpCode,
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
}

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
  async uploadTemplate(@UploadedFile() file?: UploadedFile): Promise<StoredFile> {
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
        (id, kind, file_name, storage_path, size_bytes, sha256, profile)
       VALUES ($1, 'template', $2, $3, $4, $5, $6::jsonb)`,
      [
        fileId,
        fileName,
        templatePath,
        file.size,
        createHash('sha256').update(file.buffer).digest('hex'),
        JSON.stringify(profile),
      ],
    );
    return {
      fileId,
      kind: 'template',
      fileName,
      size: file.size,
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
      profile,
    };
  }

  @Post('content')
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file'))
  async uploadContent(@UploadedFile() file?: UploadedFile): Promise<StoredFile> {
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
        (id, kind, file_name, storage_path, size_bytes, sha256)
       VALUES ($1, 'content', $2, $3, $4, $5)`,
      [
        fileId,
        fileName,
        join(directory, fileName),
        file.size,
        createHash('sha256').update(file.buffer).digest('hex'),
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
  async list(): Promise<readonly StoredFile[]> {
    const result = await this.pool.query<{
      id: string;
      kind: StoredFile['kind'];
      file_name: string;
      size_bytes: string;
      sha256: string;
      profile: unknown;
    }>(
      `SELECT id, kind, file_name, size_bytes, sha256, profile
       FROM stored_files ORDER BY created_at DESC`,
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

  @Get('templates')
  async listTemplates(): Promise<readonly StoredFile[]> {
    const result = await this.pool.query<{
      id: string;
      file_name: string;
      size_bytes: string;
      sha256: string;
      profile: unknown;
      created_at: Date;
    }>(
      `SELECT id, file_name, size_bytes, sha256, profile, created_at
       FROM stored_files WHERE kind = 'template' ORDER BY created_at DESC`,
    );
    return result.rows.map((row) => ({
      fileId: row.id,
      kind: 'template',
      fileName: row.file_name,
      size: Number(row.size_bytes),
      sha256: row.sha256,
      profile: row.profile,
    }));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
