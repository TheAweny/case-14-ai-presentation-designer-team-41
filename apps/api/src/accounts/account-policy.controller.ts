import { Body, Controller, Get, Inject, Param, Put, BadRequestException } from '@nestjs/common';
import { accountPolicySchema, accountUsageViewSchema } from '@lct/contracts';
import { AdminOnly, CurrentAccount } from './account.guard.js';
import type { Account } from './account-rules.js';
import { AccountUsageService } from './account-usage.service.js';
import { ApiAccountRoutes, ApiJsonBody } from '../docs/decorators.js';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';

@Controller('account-usage')
@ApiAccountRoutes('users')
export class AccountPolicyController {
  constructor(@Inject(AccountUsageService) private readonly usage: AccountUsageService) {}
  @Get('me')
  @ApiOkResponse({ standardSchema: accountUsageViewSchema })
  @ApiOperation({ summary: 'Своя активность и включённые ограничения' })
  me(@CurrentAccount() account: Account) {
    return this.usage.view(account.id);
  }
  @Get(':id')
  @ApiOkResponse({ standardSchema: accountUsageViewSchema })
  @ApiOperation({ summary: 'Политика и активность аккаунта' })
  @AdminOnly()
  get(@Param('id') id: string) {
    return this.usage.view(id);
  }
  @Put(':id')
  @ApiJsonBody(accountPolicySchema)
  @ApiOkResponse({ standardSchema: accountUsageViewSchema })
  @ApiOperation({ summary: 'Изменить опциональные ограничения аккаунта' })
  @AdminOnly()
  async put(@Param('id') id: string, @Body() body: unknown, @CurrentAccount() actor: Account) {
    const parsed = accountPolicySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    await this.usage.store.setPolicy(id, parsed.data, actor.id);
    return this.usage.view(id);
  }
}
