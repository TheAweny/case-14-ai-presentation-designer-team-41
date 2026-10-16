import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
} from '@nestjs/swagger';
import { z } from 'zod';
import { AdminOnly, CurrentAccount } from './account.guard.js';
import type { Account } from './account-rules.js';
import { AccountsService, type AccountPatch } from './accounts.service.js';
import { AccountDataService } from './account-data.service.js';
import { ApiAccountRoutes, ApiErrors, ApiJsonBody } from '../docs/decorators.js';
import {
  accountInputSchema,
  accountPatchSchema,
  accountSchema,
  profilePatchSchema,
} from '../docs/schemas.js';

const ACCOUNT_EXAMPLE = {
  id: '9a7c5e3b-1d2f-4a6c-8e0b-2c4e6a8c0e2d',
  email: 'maria@example.com',
  name: 'Мария Иванова',
  role: 'user',
  disabled: false,
  createdAt: '2026-10-12T15:20:00.000Z',
  avatar: null,
};
const accountParam = ApiParam({ name: 'id', example: ACCOUNT_EXAMPLE.id });

/**
 * Accounts as the administrator manages them in settings, and one's own account. Deleting an
 * account deletes what it made; switching it off keeps everything and only closes the door.
 */
@Controller('users')
@ApiAccountRoutes('users')
export class UsersController {
  constructor(
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(AccountDataService) private readonly data: AccountDataService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Свой аккаунт' })
  @ApiOkResponse({ standardSchema: accountSchema, example: ACCOUNT_EXAMPLE })
  me(@CurrentAccount() account: Account): Account {
    return account;
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Изменить свой профиль',
    description: 'Картинку и пароль меняет каждый сам; для смены пароля нужен текущий.',
  })
  @ApiJsonBody(profilePatchSchema, {
    'Выбрать знак': { avatar: 'preset:3' },
    'Сменить пароль': { currentPassword: 'old-password', password: 'new-long-password' },
  })
  @ApiOkResponse({ standardSchema: accountSchema, example: ACCOUNT_EXAMPLE })
  @ApiErrors(400)
  async updateMe(
    @CurrentAccount() account: Account,
    @Body()
    body: { name?: unknown; currentPassword?: unknown; password?: unknown; avatar?: unknown },
  ): Promise<Account> {
    if (body.password !== undefined) {
      await this.accounts.changeOwnPassword(account.id, body.currentPassword, body.password);
    }
    // Everyone picks their own picture; the name is the administrator's to change.
    if (body.name === undefined && body.avatar === undefined)
      return (await this.accounts.find(account.id)) ?? account;
    return this.accounts.update(
      account.id,
      {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.avatar === undefined ? {} : { avatar: body.avatar }),
      },
      account.id,
    );
  }

  @Get()
  @AdminOnly()
  @ApiOperation({ summary: 'Все аккаунты', description: 'Только администратор.' })
  @ApiOkResponse({ standardSchema: z.array(accountSchema), example: [ACCOUNT_EXAMPLE] })
  list(): Promise<readonly Account[]> {
    return this.accounts.list();
  }

  @Post()
  @AdminOnly()
  @ApiOperation({
    summary: 'Создать аккаунт',
    description: 'Самостоятельной регистрации нет: аккаунты заводит администратор.',
  })
  @ApiJsonBody(accountInputSchema, {
    'Новый пользователь': {
      email: 'maria@example.com',
      name: 'Мария Иванова',
      password: 'temporary-password',
      role: 'user',
    },
  })
  @ApiCreatedResponse({ standardSchema: accountSchema, example: ACCOUNT_EXAMPLE })
  @ApiErrors(400, 409)
  create(
    @Body() body: { email?: unknown; name?: unknown; password?: unknown; role?: unknown },
  ): Promise<Account> {
    return this.accounts.create(body);
  }

  @Patch(':id')
  @AdminOnly()
  @ApiOperation({
    summary: 'Изменить аккаунт',
    description: 'Почта, имя, пароль, роль или отключение. Себя понизить или отключить нельзя.',
  })
  @accountParam
  @ApiJsonBody(accountPatchSchema, {
    Отключить: { disabled: true },
    'Сделать администратором': { role: 'admin' },
  })
  @ApiOkResponse({ standardSchema: accountSchema, example: ACCOUNT_EXAMPLE })
  @ApiErrors(400, 404, 409)
  update(
    @Param('id') id: string,
    @Body() body: AccountPatch,
    @CurrentAccount() actor: Account,
  ): Promise<Account> {
    return this.accounts.update(id, body, actor.id);
  }

  @Delete(':id')
  @AdminOnly()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Удалить аккаунт',
    description: 'Вместе со всем, что он создал. Себя и последнего администратора удалить нельзя.',
  })
  @accountParam
  @ApiNoContentResponse({ description: 'Аккаунт и его данные удалены.' })
  @ApiErrors(400, 404)
  async remove(@Param('id') id: string, @CurrentAccount() actor: Account): Promise<void> {
    await this.accounts.assertRemovable(id, actor.id);
    await this.data.removeAllOf(id);
    await this.accounts.remove(id, actor.id);
  }
}
