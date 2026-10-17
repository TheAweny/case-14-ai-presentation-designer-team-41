import {
  applyDecorators,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import {
  VK_AI_SPACE_BASE_URL,
  VK_AI_SPACE_MODEL,
  VK_PROJECT_HEADER,
  connectionCheckSchema,
  modelCapabilitiesSchema,
  modelRefSchema,
  NO_REASONING_CHOICE,
  type ModelCapabilities,
  connectionInputSchema,
  connectionModelsInputSchema,
  modelConnectionSchema,
  modelSettingsErrorSchema,
  modelSettingsSchema,
  probeInputSchema,
  roleAssignmentSchema,
  type ConnectionCheck,
  type ModelConnection,
  type ModelSettings,
} from '@lct/contracts';
import { CurrentAccount } from '../accounts/account.guard.js';
import type { Account } from '../accounts/account-rules.js';
import { KeyDecryptionError, KeyVaultUnavailableError } from './key-vault.js';
import {
  InvalidModelSettingsInputError,
  ManagedConnectionError,
  ModelConnectionNotFoundError,
  ModelNotConfiguredError,
  ModelSettingsService,
  type SettingsActor,
} from './model-settings.service.js';
import { ModelCapabilityService } from './model-capabilities.js';
import { ApiAccountRoutes, ApiJsonBody } from '../docs/decorators.js';

const CONNECTION_EXAMPLE = {
  connectionId: 'vk-ai-space',
  name: 'VK AI Space',
  preset: 'vk-ai-space',
  baseUrl: VK_AI_SPACE_BASE_URL,
  hasKey: true,
  keyHint: '…9f2c',
  headers: [{ name: VK_PROJECT_HEADER, value: 'lct-41' }],
  lastCheck: { ok: true, at: '2026-10-16T09:58:00.000Z', models: [VK_AI_SPACE_MODEL] },
  enabledModels: null,
  managed: false,
  shared: true,
  editable: true,
};
const connectionParam = ApiParam({ name: 'id', example: CONNECTION_EXAMPLE.connectionId });

/** Settings refuse with `reason` from `modelSettingsErrorSchema`, not Nest's usual body. */
function ApiSettingsErrors(...statuses: (400 | 404 | 409 | 503)[]) {
  const reasons = { 400: 'invalid', 404: 'notFound', 409: 'managed', 503: 'unavailable' } as const;
  const texts = {
    400: 'Неверный ввод; в `problems` — что не так по полям.',
    404: 'Подключения нет.',
    409: 'Подключение задано окружением сервера и не редактируется.',
    503: 'Хранилище ключей недоступно: не задан `MODEL_KEYS_SECRET`.',
  } as const;
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: texts[status],
        standardSchema: modelSettingsErrorSchema,
        example: {
          reason: reasons[status],
          problems: status === 400 ? { baseUrl: 'protocol' } : {},
        },
      }),
    ),
  );
}

/**
 * Model settings for the settings window. Every answer is built from the public view, so no
 * route can return a key. Errors carry `reason` from `modelSettingsErrorSchema`, which the web
 * turns back into its own errors.
 */
function refuse(error: unknown): never {
  if (error instanceof ModelConnectionNotFoundError) {
    throw new NotFoundException({ reason: 'notFound' });
  }
  if (error instanceof InvalidModelSettingsInputError) {
    throw new BadRequestException({ reason: 'invalid', problems: error.problems });
  }
  if (error instanceof ManagedConnectionError) {
    throw new ConflictException({ reason: 'managed' });
  }
  if (error instanceof KeyVaultUnavailableError || error instanceof KeyDecryptionError) {
    throw new ServiceUnavailableException({ reason: 'unavailable', message: error.message });
  }
  throw error;
}

/** The account as the settings see it: an administrator manages what everyone shares. */
function actorOf(account: Account): SettingsActor {
  return { userId: account.id, admin: account.role === 'admin' };
}

@Controller('model-settings')
@ApiAccountRoutes('models')
export class ModelSettingsController {
  constructor(
    @Inject(ModelSettingsService) private readonly settings: ModelSettingsService,
    @Inject(ModelCapabilityService) private readonly capabilities: ModelCapabilityService,
  ) {}

  @Get('capabilities')
  @ApiOperation({
    summary: 'Возможности модели',
    description:
      'Как у модели включается размышление и меняет ли что-то глубина. Узнаётся короткими запросами к самой модели при первом обращении и запоминается; по имени модели ничего не решается.',
  })
  @ApiOkResponse({ standardSchema: modelCapabilitiesSchema })
  async capabilitiesOf(
    @Query('connectionId') connectionId: unknown,
    @Query('modelId') modelId: unknown,
    @CurrentAccount() account: Account,
  ): Promise<ModelCapabilities> {
    const ref = modelRefSchema.safeParse({ connectionId, modelId });
    if (!ref.success) throw new BadRequestException({ reason: 'invalid' });
    return this.capabilities.capabilitiesOf(ref.data, actorOf(account)).catch((error: unknown) => {
      // A model that cannot be used offers nothing to choose; picking it says why elsewhere.
      if (error instanceof ModelNotConfiguredError) {
        return { reasoning: NO_REASONING_CHOICE, probed: false };
      }
      return refuse(error);
    });
  }

  @Get()
  @ApiOperation({
    summary: 'Настройки моделей',
    description:
      'Подключения и модель для каждой роли пайплайна. Ключ не возвращается никогда: только `hasKey` и последние символы.',
  })
  @ApiOkResponse({ standardSchema: modelSettingsSchema })
  async get(@CurrentAccount() account: Account): Promise<ModelSettings> {
    const actor = actorOf(account);
    return this.capabilities.withKinds(await this.settings.get(actor), actor);
  }

  @Post('connections')
  @ApiOperation({
    summary: 'Сохранить подключение',
    description:
      'Без `connectionId` — новое, с ним — правка. Пустой `apiKey` при правке оставляет сохранённый ключ. Ключ хранится зашифрованным (AES-256-GCM).',
  })
  @ApiJsonBody(connectionInputSchema, {
    'VK AI Space': {
      name: 'VK AI Space',
      preset: 'vk-ai-space',
      baseUrl: VK_AI_SPACE_BASE_URL,
      apiKey: 'sk-…',
      headers: [{ name: VK_PROJECT_HEADER, value: 'lct-41' }],
      shared: true,
    },
  })
  @ApiResponse({ status: 201, standardSchema: modelConnectionSchema, example: CONNECTION_EXAMPLE })
  @ApiSettingsErrors(400, 404, 409, 503)
  async saveConnection(
    @Body() body: unknown,
    @CurrentAccount() account: Account,
  ): Promise<ModelConnection> {
    const actor = actorOf(account);
    const saved = await this.settings.saveConnection(body, actor).catch(refuse);
    // A new or changed connection: every model is probed now, in the background.
    void this.capabilities.classify(saved.connectionId, actor, true);
    return saved;
  }

  @Delete('connections/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить подключение' })
  @connectionParam
  @ApiNoContentResponse({ description: 'Подключение удалено.' })
  @ApiSettingsErrors(404, 409)
  async deleteConnection(
    @Param('id') connectionId: string,
    @CurrentAccount() account: Account,
  ): Promise<void> {
    await this.settings.deleteConnection(connectionId, actorOf(account)).catch(refuse);
  }

  @Post('connections/:id/check')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Проверить подключение',
    description: 'Запрашивает у сервера список моделей и запоминает результат в `lastCheck`.',
  })
  @connectionParam
  @ApiOkResponse({ standardSchema: modelConnectionSchema, example: CONNECTION_EXAMPLE })
  @ApiSettingsErrors(404, 503)
  async checkConnection(
    @Param('id') connectionId: string,
    @CurrentAccount() account: Account,
  ): Promise<ModelConnection> {
    const actor = actorOf(account);
    const checked = await this.settings.checkConnection(connectionId, actor).catch(refuse);
    // The person asked to check: every model is probed again, in the background.
    void this.capabilities.classify(connectionId, actor, true);
    return checked;
  }

  @Put('connections/:id/models')
  @ApiOperation({
    summary: 'Какие модели подключения доступны',
    description: '`null` снимает ограничение, пустой список выключает все модели.',
  })
  @connectionParam
  @ApiJsonBody(connectionModelsInputSchema, {
    'Одна модель': {
      connectionId: CONNECTION_EXAMPLE.connectionId,
      enabledModels: [VK_AI_SPACE_MODEL],
    },
  })
  @ApiOkResponse({ standardSchema: modelConnectionSchema, example: CONNECTION_EXAMPLE })
  @ApiSettingsErrors(400, 404, 409)
  async setConnectionModels(
    @Param('id') connectionId: string,
    @Body() body: unknown,
    @CurrentAccount() account: Account,
  ): Promise<ModelConnection> {
    const input =
      body !== null && typeof body === 'object' ? { ...body, connectionId } : { connectionId };
    const actor = actorOf(account);
    const updated = await this.settings.setConnectionModels(input, actor).catch(refuse);
    // Models switched on that were never probed are probed now; the rest keep their findings.
    void this.capabilities.classify(connectionId, actor, false);
    return updated;
  }

  @Post('probe')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Проверить адрес и ключ до сохранения',
    description: 'С `connectionId` и без ключа берётся сохранённый ключ.',
  })
  @ApiJsonBody(probeInputSchema, {
    'Новый сервер': { baseUrl: VK_AI_SPACE_BASE_URL, apiKey: 'sk-…' },
  })
  @ApiOkResponse({
    standardSchema: connectionCheckSchema,
    example: { ok: true, at: '2026-10-16T09:58:00.000Z', models: [VK_AI_SPACE_MODEL] },
  })
  @ApiSettingsErrors(400, 404, 503)
  probe(@Body() body: unknown, @CurrentAccount() account: Account): Promise<ConnectionCheck> {
    return this.settings.probe(body, actorOf(account)).catch(refuse);
  }

  @Put('roles')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Назначить модель роли',
    description:
      'Роль пайплайна: планировщик, писатель, критик, зрение, картинки. Выбор администратора — по умолчанию для всех.',
  })
  @ApiJsonBody(roleAssignmentSchema, {
    'Писатель на Qwen': {
      role: 'writer',
      kind: 'model',
      connectionId: CONNECTION_EXAMPLE.connectionId,
      modelId: VK_AI_SPACE_MODEL,
    },
  })
  @ApiNoContentResponse({ description: 'Роль назначена.' })
  @ApiSettingsErrors(400, 404)
  async setRole(@Body() body: unknown, @CurrentAccount() account: Account): Promise<void> {
    await this.settings.setRole(body, actorOf(account)).catch(refuse);
  }
}
