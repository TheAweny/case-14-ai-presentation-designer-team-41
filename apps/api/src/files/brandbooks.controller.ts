import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Patch,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
  UnprocessableEntityException,
  ServiceUnavailableException,
  GatewayTimeoutException,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation } from '@nestjs/swagger';
import { brandbookProfileSchema, type BrandbookProfile } from '@lct/contracts';
import { EngineClient, EngineHttpError } from '@lct/engine-client';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Pool } from 'pg';
import { CurrentAccount } from '../accounts/account.guard.js';
import type { Account } from '../accounts/account-rules.js';
import { AccountUsageService } from '../accounts/account-usage.service.js';
import { ApiAccountRoutes, ApiErrors } from '../docs/decorators.js';
import { decodeMultipartFilename } from './filename.js';
import { visibleFile } from './template-visibility.js';

interface Upload {
  readonly originalname: string;
  readonly size: number;
  readonly buffer: Buffer;
}
interface BrandbookRow {
  id: string;
  file_name: string;
  display_name?: string | null;
  storage_path: string;
  size_bytes: number | string;
  sha256: string;
  profile: unknown;
  owner_id: string;
  shared: boolean;
  created_at: Date | string;
}
export interface StoredBrandbook {
  fileId: string;
  kind: 'brandbook';
  fileName: string;
  size: number;
  sha256: string;
  profile: BrandbookProfile;
  name: string;
  mine: boolean;
  shared: boolean;
  createdAt: string;
}
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
const BRANDBOOK_NAME_MAX_LENGTH = 200;
const EXTENSIONS = new Set([
  '.zip',
  '.rar',
  '.fig',
  '.pdf',
  '.json',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.pptx',
  '.potx',
]);
function inside(root: string, path: string): boolean {
  const pathRelative = relative(root, path);
  return (
    pathRelative !== '' &&
    !isAbsolute(pathRelative) &&
    pathRelative !== '..' &&
    !pathRelative.startsWith(`..${sep}`)
  );
}
function safeAssetName(name: string): string {
  let value = '';
  for (const character of name) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) continue;
    value += character === '/' || character === '\\' ? '_' : character;
  }
  return value;
}

@Controller('files')
@ApiAccountRoutes('files')
export class BrandbooksController implements OnApplicationShutdown {
  constructor(
    @Optional() @Inject(AccountUsageService) private readonly usage?: AccountUsageService,
  ) {}
  private readonly root = resolve(process.env.RUNS_DIR ?? join(process.cwd(), 'runs'));
  private readonly engine = new EngineClient({
    baseUrl: process.env.ENGINE_URL ?? 'http://localhost:8000',
    timeoutMs: 120_000,
  });
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });

  @Post('brandbook')
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  @ApiOperation({ summary: 'Загрузить и разобрать брендбук с доказательствами извлечённых правил' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiErrors(400, 403, 422, 503, 504)
  async upload(
    @CurrentAccount() account: Account,
    @UploadedFile() file?: Upload,
  ): Promise<StoredBrandbook> {
    if (!file) throw new BadRequestException('Field file is required.');
    const fileName = decodeMultipartFilename(file.originalname);
    const extension = extname(fileName).toLowerCase();
    if (!EXTENSIONS.has(extension))
      throw new BadRequestException('Unsupported brandbook file type.');
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES || file.size !== file.buffer.length)
      throw new BadRequestException('Brandbook must contain between 1 byte and 64 MiB.');
    const fileId = randomUUID();
    const directory = join(this.root, 'brandbooks', fileId);
    const cleanup = async () => {
      await rm(directory, { recursive: true, force: true });
      await this.pool.query('DELETE FROM stored_files WHERE id=$1 AND owner_id=$2', [
        fileId,
        account.id,
      ]);
    };
    const save = async (): Promise<StoredBrandbook> => {
      await mkdir(directory, { recursive: true });
      const path = join(directory, `original${extension}`);
      await writeFile(path, file.buffer);
      let profile: BrandbookProfile;
      try {
        profile = brandbookProfileSchema.parse(
          await this.engine.parseBrandbook({
            schemaVersion: 1,
            path,
            outputDir: join(directory, 'assets'),
          }),
        );
      } catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError')
          throw new GatewayTimeoutException('Разбор брендбука превысил допустимое время.');
        if (!(error instanceof EngineHttpError) || error.status === 422)
          throw new UnprocessableEntityException(
            'Не удалось разобрать брендбук или проверить его профиль.',
          );
        throw new ServiceUnavailableException('Сервис разбора брендбуков временно недоступен.');
      }
      const sha256 = createHash('sha256').update(file.buffer).digest('hex');
      const createdAt = new Date().toISOString();
      await this.pool.query(
        `INSERT INTO stored_files (id,kind,file_name,storage_path,size_bytes,sha256,profile,owner_id)
         VALUES ($1,'brandbook',$2,$3,$4,$5,$6::jsonb,$7)`,
        [fileId, fileName, path, file.size, sha256, JSON.stringify(profile), account.id],
      );
      return {
        fileId,
        kind: 'brandbook',
        fileName,
        size: file.size,
        sha256,
        profile,
        name: fileName,
        mine: true,
        shared: false,
        createdAt,
      };
    };
    // Reserve the bounded upload plus parser expansion before writing; zero would bypass quota.
    if (this.usage) return this.usage.write(account.id, MAX_UPLOAD_BYTES, save, cleanup);
    try {
      return await save();
    } catch (error) {
      await cleanup();
      throw error;
    }
  }

  @Get('brandbooks')
  @ApiOperation({ summary: 'Брендбуки аккаунта и общие брендбуки' })
  async list(@CurrentAccount() account: Account): Promise<StoredBrandbook[]> {
    const result = await this.pool.query<BrandbookRow>(
      `SELECT * FROM stored_files WHERE kind='brandbook' AND ${visibleFile(1)} ORDER BY created_at DESC`,
      [account.id],
    );
    return result.rows.map((row) => this.present(row, account));
  }

  @Get('brandbooks/:id')
  @ApiOperation({ summary: 'Профиль брендбука с источниками, токенами и ресурсами' })
  async get(@CurrentAccount() account: Account, @Param('id') id: string): Promise<StoredBrandbook> {
    return this.present(await this.find(id, account), account);
  }

  @Patch('brandbooks/:id')
  @ApiOperation({
    summary: 'Переименовать брендбук или открыть его всем',
    description: 'Переименовывает владелец; `shared` меняет только администратор.',
  })
  @ApiErrors(400, 403, 404)
  async update(
    @CurrentAccount() account: Account,
    @Param('id') id: string,
    @Body() body: { name?: unknown; shared?: unknown },
  ): Promise<StoredBrandbook> {
    const row = await this.find(id, account);
    if (row.owner_id !== account.id && account.role !== 'admin')
      throw new ForbiddenException('Only the owner or an administrator can change a brandbook.');
    if (body.shared !== undefined) {
      if (typeof body.shared !== 'boolean')
        throw new BadRequestException('shared must be a boolean.');
      if (account.role !== 'admin')
        throw new ForbiddenException('Only an administrator can share a brandbook.');
    }
    let name: string | null = null;
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim() === '')
        throw new BadRequestException('Brandbook name is required.');
      name = body.name.trim();
      if (name.length > BRANDBOOK_NAME_MAX_LENGTH)
        throw new BadRequestException('Brandbook name is too long.');
    }
    const result = await this.pool.query<BrandbookRow>(
      `UPDATE stored_files SET display_name = COALESCE($2, display_name),
              shared = COALESCE($3, shared)
       WHERE id = $1 RETURNING *`,
      [row.id, name, typeof body.shared === 'boolean' ? body.shared : null],
    );
    const updated = result.rows[0];
    if (!updated) throw new NotFoundException('Brandbook not found.');
    return this.present(updated, account);
  }

  @Delete('brandbooks/:id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Убрать брендбук из библиотеки',
    description: 'Файлы остаются: сборки, уже сделанные по брендбуку, повторяются как были.',
  })
  @ApiErrors(403, 404)
  async remove(@CurrentAccount() account: Account, @Param('id') id: string): Promise<void> {
    const row = await this.find(id, account);
    if (row.owner_id !== account.id && account.role !== 'admin')
      throw new ForbiddenException('Only the owner or an administrator can delete a brandbook.');
    await this.pool.query('UPDATE stored_files SET deleted_at = now() WHERE id = $1', [row.id]);
  }

  @Get('brandbooks/:id/assets/:assetId')
  @ApiOperation({ summary: 'Скачать извлечённый ресурс брендбука' })
  async asset(
    @CurrentAccount() account: Account,
    @Param('id') id: string,
    @Param('assetId') assetId: string,
  ): Promise<StreamableFile> {
    const row = await this.find(id, account);
    const profile = brandbookProfileSchema.parse(row.profile);
    const asset = profile.assets.find((item) => item.id === assetId);
    if (!asset || isAbsolute(asset.path) || asset.path.includes('\\'))
      throw new NotFoundException('Asset not found.');
    const directory = join(dirname(row.storage_path), 'assets');
    const path = resolve(directory, asset.path);
    if (!inside(directory, path)) throw new NotFoundException('Asset not found.');
    const canonical = await realpath(path).catch(() => null);
    const canonicalRoot = await realpath(directory).catch(() => null);
    if (!canonical || !canonicalRoot || !inside(canonicalRoot, canonical))
      throw new NotFoundException('Asset not found.');
    const handle = await open(canonical, 'r').catch(() => null);
    if (!handle) throw new NotFoundException('Asset not found.');
    const stat = await handle.stat();
    if (!stat.isFile()) {
      await handle.close();
      throw new NotFoundException('Asset not found.');
    }
    return new StreamableFile(handle.createReadStream(), {
      type: asset.mediaType,
      disposition: `attachment; filename="asset"; filename*=UTF-8''${encodeURIComponent(safeAssetName(asset.name)).replace(/['()*]/g, (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase())}`,
      length: stat.size,
    });
  }
  private async find(id: string, account: Account): Promise<BrandbookRow> {
    const result = await this.pool.query<BrandbookRow>(
      `SELECT * FROM stored_files WHERE id=$1 AND kind='brandbook' AND ${visibleFile(2)}`,
      [id, account.id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Brandbook not found.');
    return row;
  }
  private present(row: BrandbookRow, account: Account): StoredBrandbook {
    return {
      fileId: row.id,
      kind: 'brandbook',
      fileName: row.file_name,
      size: Number(row.size_bytes),
      sha256: row.sha256,
      profile: brandbookProfileSchema.parse(row.profile),
      name: row.display_name?.trim() || row.file_name,
      mine: row.owner_id === account.id,
      shared: row.shared,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }
  async onApplicationShutdown() {
    await this.pool.end();
  }
}
