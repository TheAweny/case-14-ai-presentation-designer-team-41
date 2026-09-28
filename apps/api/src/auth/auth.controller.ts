import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { AnonymousRoute } from '../accounts/account.guard.js';
import type { Account } from '../accounts/account-rules.js';
import { AccountsService } from '../accounts/accounts.service.js';

interface Credentials {
  readonly email?: unknown;
  readonly password?: unknown;
}

/**
 * Every answer is a JSON object. An unknown account is `{ "account": null }` rather than an
 * empty 200, which a client reading JSON cannot tell from a broken response.
 */
interface AccountAnswer {
  readonly account: Account | null;
}

/**
 * Sign-in for the web server, which keeps the session. These routes come before an account, so
 * they are anonymous; the service token still guards them. A switched-off account is answered as
 * no account at all: its session ends on the next page.
 */
@Controller('auth')
@AnonymousRoute()
export class AuthController {
  constructor(@Inject(AccountsService) private readonly accounts: AccountsService) {}

  @Get('accounts')
  async hasAccounts(): Promise<{ hasAccounts: boolean }> {
    return { hasAccounts: await this.accounts.hasAccounts() };
  }

  @Post('verify')
  @HttpCode(200)
  async verify(@Body() body: Credentials): Promise<AccountAnswer> {
    if (typeof body.email !== 'string' || typeof body.password !== 'string') {
      throw new BadRequestException('Email and password are required.');
    }
    return { account: await this.accounts.verify(body.email, body.password) };
  }

  @Get('accounts/:id')
  async getAccount(@Param('id') id: string): Promise<AccountAnswer> {
    const account = await this.accounts.find(id);
    return { account: account && !account.disabled ? account : null };
  }
}
