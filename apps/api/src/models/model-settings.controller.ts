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
import { CurrentAccount } from '../accounts/account.guard.js';
import type { Account } from '../accounts/account-rules.js';
import { KeyDecryptionError, KeyVaultUnavailableError } from './key-vault.js';
import {
  InvalidModelSettingsInputError,
  ManagedConnectionError,
  ModelConnectionNotFoundError,
  ModelSettingsService,
  type SettingsActor,
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

/** The account as the settings see it: an administrator manages what everyone shares. */
function actorOf(account: Account): SettingsActor {
  return { userId: account.id, admin: account.role === 'admin' };
}

@Controller('model-settings')
export class ModelSettingsController {
  constructor(@Inject(ModelSettingsService) private readonly settings: ModelSettingsService) {}

  @Get()
  get(@CurrentAccount() account: Account): Promise<ModelSettings> {
    return this.settings.get(actorOf(account));
  }

  @Post('connections')
  saveConnection(
    @Body() body: unknown,
    @CurrentAccount() account: Account,
  ): Promise<ModelConnection> {
    return this.settings.saveConnection(body, actorOf(account)).catch(refuse);
  }

  @Delete('connections/:id')
  @HttpCode(204)
  async deleteConnection(
    @Param('id') connectionId: string,
    @CurrentAccount() account: Account,
  ): Promise<void> {
    await this.settings.deleteConnection(connectionId, actorOf(account)).catch(refuse);
  }

  @Post('connections/:id/check')
  @HttpCode(200)
  checkConnection(
    @Param('id') connectionId: string,
    @CurrentAccount() account: Account,
  ): Promise<ModelConnection> {
    return this.settings.checkConnection(connectionId, actorOf(account)).catch(refuse);
  }

  @Put('connections/:id/models')
  setConnectionModels(
    @Param('id') connectionId: string,
    @Body() body: unknown,
    @CurrentAccount() account: Account,
  ): Promise<ModelConnection> {
    const input =
      body !== null && typeof body === 'object' ? { ...body, connectionId } : { connectionId };
    return this.settings.setConnectionModels(input, actorOf(account)).catch(refuse);
  }

  @Post('probe')
  @HttpCode(200)
  probe(@Body() body: unknown, @CurrentAccount() account: Account): Promise<ConnectionCheck> {
    return this.settings.probe(body, actorOf(account)).catch(refuse);
  }

  @Put('roles')
  @HttpCode(204)
  async setRole(@Body() body: unknown, @CurrentAccount() account: Account): Promise<void> {
    await this.settings.setRole(body, actorOf(account)).catch(refuse);
  }
}
