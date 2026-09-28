import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';

const roles = ['planner', 'writer', 'critic', 'vision', 'image'] as const;
type Role = (typeof roles)[number];
type SettingsInput = { userId?: unknown };
type ConnectionInput = SettingsInput & {
  connectionId?: unknown;
  name?: unknown;
  preset?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
  lastCheck?: unknown;
};
type AssignmentInput = SettingsInput & {
  role?: unknown;
  kind?: unknown;
  connectionId?: unknown;
  modelId?: unknown;
};
type ConnectionRow = {
  id: string;
  name: string;
  preset: string;
  base_url: string;
  api_key_ciphertext: string | null;
  last_check: unknown;
};
type AssignmentRow = {
  role: Role;
  kind: 'model' | 'disabled' | 'unassigned';
  connection_id: string | null;
  model_id: string | null;
};

@Controller('model-settings')
export class ModelSettingsController implements OnApplicationShutdown {
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });

  @Get()
  async get(@Query('userId') userId: string) {
    return this.settings(this.userId(userId));
  }

  @Put('connections')
  async save(@Body() body: ConnectionInput) {
    const userId = this.userId(body.userId);
    const name = this.text(body.name, 60);
    const preset = this.preset(body.preset);
    const baseUrl = this.url(body.baseUrl);
    const id = typeof body.connectionId === 'string' ? body.connectionId : randomUUID();
    const existing = body.connectionId !== undefined ? await this.owned(userId, id) : null;
    const key =
      typeof body.apiKey === 'string' && body.apiKey.trim()
        ? this.encrypt(this.apiKey(body.apiKey))
        : null;
    const effectiveKey = key ?? existing?.api_key_ciphertext ?? null;
    // I persist a check made by this server, never a result supplied by the browser.
    const lastCheck = await this.check(baseUrl, effectiveKey ? this.decrypt(effectiveKey) : null);
    await this.pool.query(
      `INSERT INTO user_model_connections(id,user_id,name,preset,base_url,api_key_ciphertext,last_check)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,preset=EXCLUDED.preset,base_url=EXCLUDED.base_url,
         api_key_ciphertext=COALESCE(EXCLUDED.api_key_ciphertext,user_model_connections.api_key_ciphertext),
         last_check=EXCLUDED.last_check,updated_at=now()`,
      [id, userId, name, preset, baseUrl, key, JSON.stringify(lastCheck)],
    );
    return { connection: await this.connection(userId, id), settings: await this.settings(userId) };
  }

  @Delete('connections/:id')
  async remove(@Param('id') id: string, @Query('userId') userId: string) {
    await this.owned(this.userId(userId), id);
    await this.pool.query('DELETE FROM user_model_connections WHERE id=$1', [id]);
    return this.settings(userId);
  }

  @Put('roles')
  async role(@Body() body: AssignmentInput) {
    const userId = this.userId(body.userId);
    if (
      !roles.includes(body.role as Role) ||
      !['model', 'disabled', 'unassigned'].includes(String(body.kind))
    )
      throw new BadRequestException('Invalid role assignment.');
    const kind = String(body.kind);
    const connectionId =
      kind === 'model' && typeof body.connectionId === 'string' ? body.connectionId : null;
    const modelId = kind === 'model' ? this.text(body.modelId, 256) : null;
    if (connectionId) {
      const connection = await this.owned(userId, connectionId);
      if (!(await this.hasCheckedModel(connection, modelId))) {
        throw new BadRequestException(
          'Select a model returned by the latest successful connection check.',
        );
      }
    }
    await this.pool.query(
      `INSERT INTO user_model_role_assignments(user_id,role,kind,connection_id,model_id)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id,role) DO UPDATE SET kind=EXCLUDED.kind,connection_id=EXCLUDED.connection_id,model_id=EXCLUDED.model_id,updated_at=now()`,
      [userId, body.role, kind, connectionId, modelId],
    );
    return this.settings(userId);
  }

  @Post('probe')
  async probe(@Body() body: ConnectionInput) {
    const userId = this.userId(body.userId);
    const existing =
      typeof body.connectionId === 'string' ? await this.owned(userId, body.connectionId) : null;
    const apiKey =
      typeof body.apiKey === 'string' && body.apiKey.trim()
        ? this.apiKey(body.apiKey)
        : existing?.api_key_ciphertext
          ? this.decrypt(existing.api_key_ciphertext)
          : null;
    return this.check(this.url(body.baseUrl), apiKey);
  }

  @Post('connections/:id/check')
  async checkStored(@Param('id') id: string, @Body() body: SettingsInput) {
    const userId = this.userId(body.userId);
    const row = await this.owned(userId, id);
    const check = await this.check(
      row.base_url,
      row.api_key_ciphertext ? this.decrypt(row.api_key_ciphertext) : null,
    );
    await this.pool.query(
      'UPDATE user_model_connections SET last_check=$1::jsonb,updated_at=now() WHERE id=$2',
      [JSON.stringify(check), id],
    );
    return this.settings(userId);
  }

  async provider(
    userId: string,
    requested: { connectionId: string; modelId: string } | null,
    role: Role = 'writer',
  ) {
    const stored = (
      await this.pool.query<{ connection_id: string; model_id: string }>(
        `SELECT connection_id,model_id FROM user_model_role_assignments WHERE user_id=$1 AND role=$2 AND kind='model'`,
        [userId, role],
      )
    ).rows[0];
    const assignment = requested
      ? { connectionId: requested.connectionId, modelId: requested.modelId }
      : stored
        ? { connectionId: stored.connection_id, modelId: stored.model_id }
        : null;
    if (assignment === null) return null;
    const row = (
      await this.pool.query<{ base_url: string; api_key_ciphertext: string | null }>(
        'SELECT base_url,api_key_ciphertext FROM user_model_connections WHERE id=$1 AND user_id=$2',
        [assignment.connectionId, userId],
      )
    ).rows[0];
    if (!row) throw new NotFoundException('Configured model connection was not found.');
    return {
      baseUrl: row.base_url,
      apiKey: row.api_key_ciphertext ? this.decrypt(row.api_key_ciphertext) : '',
      model: assignment.modelId,
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }

  private async settings(userId: string) {
    await this.user(userId);
    const connections = (
      await this.pool.query<ConnectionRow>(
        'SELECT * FROM user_model_connections WHERE user_id=$1 ORDER BY created_at',
        [userId],
      )
    ).rows.map((row) => this.public(row));
    const assigned = (
      await this.pool.query<AssignmentRow>(
        'SELECT * FROM user_model_role_assignments WHERE user_id=$1',
        [userId],
      )
    ).rows;
    return {
      connections,
      roles: roles.map((role) => {
        const row = assigned.find((item) => item.role === role);
        return row
          ? {
              role,
              kind: row.kind,
              ...(row.kind === 'model'
                ? { connectionId: row.connection_id, modelId: row.model_id }
                : {}),
            }
          : { role, kind: 'unassigned' };
      }),
    };
  }
  private async connection(userId: string, id: string) {
    return this.public(await this.owned(userId, id));
  }
  private public(row: ConnectionRow) {
    const key = row.api_key_ciphertext ? this.decrypt(row.api_key_ciphertext) : null;
    return {
      connectionId: row.id,
      name: row.name,
      preset: row.preset,
      baseUrl: row.base_url,
      hasKey: key !== null,
      keyHint: key && key.length >= 12 ? key.slice(-4) : null,
      lastCheck: row.last_check,
    };
  }
  private async owned(userId: string, id: string): Promise<ConnectionRow> {
    const row = (
      await this.pool.query<ConnectionRow>(
        'SELECT * FROM user_model_connections WHERE id=$1 AND user_id=$2',
        [id, userId],
      )
    ).rows[0];
    if (!row) throw new NotFoundException('Model connection not found.');
    return row;
  }
  private async user(id: string) {
    const exists = await this.pool.query('SELECT 1 FROM app_users WHERE id=$1', [id]);
    if (!exists.rowCount) throw new NotFoundException('User not found.');
  }
  private userId(value: unknown) {
    if (typeof value !== 'string' || !value.trim() || value.length > 120)
      throw new BadRequestException('Invalid user.');
    return value;
  }
  private text(value: unknown, max: number) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
      throw new BadRequestException('Invalid setting.');
    return value.trim();
  }
  private preset(value: unknown) {
    const preset = this.text(value, 30);
    if (!['ollama', 'lm-studio', 'vllm', 'custom'].includes(preset))
      throw new BadRequestException('Invalid model preset.');
    return preset;
  }
  private apiKey(value: string) {
    const key = value.trim();
    if (key.length > 512 || /\s/.test(key)) throw new BadRequestException('Invalid API key.');
    return key;
  }
  private url(value: unknown) {
    const text = this.text(value, 2048).replace(/\/+$/, '');
    try {
      const url = new URL(text);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new Error();
      return text;
    } catch {
      throw new BadRequestException('Invalid model URL.');
    }
  }
  private secret() {
    return createHash('sha256')
      .update(
        process.env.MODEL_SETTINGS_ENCRYPTION_KEY ||
          process.env.MODEL_API_KEY ||
          'lct-local-model-settings',
      )
      .digest();
  }
  private encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.secret(), iv);
    return Buffer.concat([
      iv,
      cipher.update(value, 'utf8'),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString('base64url');
  }
  private decrypt(value: string) {
    const data = Buffer.from(value, 'base64url');
    const iv = data.subarray(0, 12);
    const tag = data.subarray(data.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', this.secret(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]).toString(
      'utf8',
    );
  }
  private async hasCheckedModel(
    connection: ConnectionRow,
    modelId: string | null,
  ): Promise<boolean> {
    if (!modelId || !connection.last_check || typeof connection.last_check !== 'object')
      return false;
    const check = connection.last_check as { ok?: unknown; models?: unknown };
    return check.ok === true && Array.isArray(check.models) && check.models.includes(modelId);
  }
  private async check(baseUrl: string, apiKey: string | null) {
    const at = new Date().toISOString();
    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 401 || response.status === 403)
        return { ok: false, at, error: { kind: 'unauthorized', status: response.status } };
      if (!response.ok) return { ok: false, at, error: { kind: 'http', status: response.status } };
      const body = (await response.json()) as { data?: unknown };
      if (!Array.isArray(body.data)) return { ok: false, at, error: { kind: 'invalid-response' } };
      return {
        ok: true,
        at,
        models: body.data
          .flatMap((item) =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as { id?: unknown }).id === 'string'
              ? [(item as { id: string }).id.trim()]
              : [],
          )
          .filter(Boolean)
          .slice(0, 500),
      };
    } catch (error) {
      return {
        ok: false,
        at,
        error: {
          kind:
            error instanceof DOMException && error.name === 'TimeoutError'
              ? 'timeout'
              : 'unreachable',
          detail: null,
        },
      };
    }
  }
}
