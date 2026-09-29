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
import { AdminOnly, CurrentAccount } from './account.guard.js';
import type { Account } from './account-rules.js';
import { AccountsService, type AccountPatch } from './accounts.service.js';
import { AccountDataService } from './account-data.service.js';

/**
 * Accounts as the administrator manages them in settings, and one's own account. Deleting an
 * account deletes what it made; switching it off keeps everything and only closes the door.
 */
@Controller('users')
export class UsersController {
  constructor(
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(AccountDataService) private readonly data: AccountDataService,
  ) {}

  @Get('me')
  me(@CurrentAccount() account: Account): Account {
    return account;
  }

  @Patch('me')
  async updateMe(
    @CurrentAccount() account: Account,
    @Body() body: { name?: unknown; currentPassword?: unknown; password?: unknown },
  ): Promise<Account> {
    if (body.password !== undefined) {
      await this.accounts.changeOwnPassword(account.id, body.currentPassword, body.password);
    }
    if (body.name === undefined) return (await this.accounts.find(account.id)) ?? account;
    return this.accounts.update(account.id, { name: body.name }, account.id);
  }

  @Get()
  @AdminOnly()
  list(): Promise<readonly Account[]> {
    return this.accounts.list();
  }

  @Post()
  @AdminOnly()
  create(
    @Body() body: { email?: unknown; name?: unknown; password?: unknown; role?: unknown },
  ): Promise<Account> {
    return this.accounts.create(body);
  }

  @Patch(':id')
  @AdminOnly()
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
  async remove(@Param('id') id: string, @CurrentAccount() actor: Account): Promise<void> {
    await this.accounts.assertRemovable(id, actor.id);
    await this.data.removeAllOf(id);
    await this.accounts.remove(id, actor.id);
  }
}
