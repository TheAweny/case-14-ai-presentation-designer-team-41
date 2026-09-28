import {
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
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConnectionCheck, ModelConnection, ModelSettings } from '@lct/contracts';
import { ActingUser } from '../auth/service-token.guard.js';
import { KeyDecryptionError, KeyVaultUnavailableError } from './key-vault.js';
import {
  InvalidModelSettingsInputError,
  ManagedConnectionError,
  ModelConnectionNotFoundError,
  ModelSettingsService,
} from './model-settings.service.js';

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

@Controller('model-settings')
export class ModelSettingsController {
  constructor(@Inject(ModelSettingsService) private readonly settings: ModelSettingsService) {}

  @Get()
  get(): Promise<ModelSettings> {
    return this.settings.get();
  }

  @Post('connections')
  saveConnection(
    @Body() body: unknown,
    @ActingUser() userId: string | null,
  ): Promise<ModelConnection> {
    return this.settings.saveConnection(body, userId).catch(refuse);
  }

  @Delete('connections/:id')
  @HttpCode(204)
  async deleteConnection(
    @Param('id') connectionId: string,
    @ActingUser() userId: string | null,
  ): Promise<void> {
    await this.settings.deleteConnection(connectionId, userId).catch(refuse);
  }

  @Post('connections/:id/check')
  @HttpCode(200)
  checkConnection(@Param('id') connectionId: string): Promise<ModelConnection> {
    return this.settings.checkConnection(connectionId).catch(refuse);
  }

  @Post('probe')
  @HttpCode(200)
  probe(@Body() body: unknown): Promise<ConnectionCheck> {
    return this.settings.probe(body).catch(refuse);
  }

  @Put('roles')
  @HttpCode(204)
  async setRole(@Body() body: unknown, @ActingUser() userId: string | null): Promise<void> {
    await this.settings.setRole(body, userId).catch(refuse);
  }
}
