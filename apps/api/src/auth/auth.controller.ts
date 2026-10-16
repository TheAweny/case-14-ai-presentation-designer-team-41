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
import { ApiOkResponse, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AnonymousRoute } from '../accounts/account.guard.js';
import type { Account } from '../accounts/account-rules.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { ApiErrors, ApiJsonBody } from '../docs/decorators.js';
import { DOCS_TAGS } from '../docs/openapi.js';
import { accountSchema, credentialsSchema } from '../docs/schemas.js';

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

const accountAnswerSchema = z.object({ account: accountSchema.nullable() });

const ACCOUNT_EXAMPLE = {
  account: {
    id: '6f1c2a9e-3b7d-4c51-9a0e-2d8f4b6c1e73',
    email: 'admin@example.com',
    name: 'Администратор',
    role: 'admin',
    disabled: false,
    createdAt: '2026-10-01T09:00:00.000Z',
    avatar: 'preset:3',
  },
};

/**
 * Sign-in for the web server, which keeps the session. These routes come before an account, so
 * they are anonymous; the service token still guards them. A switched-off account is answered as
 * no account at all: its session ends on the next page.
 */
@Controller('auth')
@AnonymousRoute()
@ApiTags(DOCS_TAGS.auth)
@ApiSecurity('serviceToken')
@ApiErrors(403)
export class AuthController {
  constructor(@Inject(AccountsService) private readonly accounts: AccountsService) {}

  @Get('accounts')
  @ApiOperation({
    summary: 'Есть ли аккаунты',
    description: 'Пустая установка: страница входа предлагает создать администратора.',
  })
  @ApiOkResponse({
    standardSchema: z.object({ hasAccounts: z.boolean() }),
    example: { hasAccounts: true },
  })
  async hasAccounts(): Promise<{ hasAccounts: boolean }> {
    return { hasAccounts: await this.accounts.hasAccounts() };
  }

  @Post('verify')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Проверить почту и пароль',
    description:
      'Неверный пароль, неизвестная почта и отключённый аккаунт отвечают `{ "account": null }`.',
  })
  @ApiJsonBody(credentialsSchema, {
    'Вход администратора': { email: 'admin@example.com', password: 'correct-horse-battery' },
  })
  @ApiOkResponse({ standardSchema: accountAnswerSchema, example: ACCOUNT_EXAMPLE })
  @ApiErrors(400)
  async verify(@Body() body: Credentials): Promise<AccountAnswer> {
    if (typeof body.email !== 'string' || typeof body.password !== 'string') {
      throw new BadRequestException('Email and password are required.');
    }
    return { account: await this.accounts.verify(body.email, body.password) };
  }

  @Get('accounts/:id')
  @ApiOperation({
    summary: 'Аккаунт по id',
    description: 'Веб-сервер проверяет сессию на каждой странице. Отключённый — `null`.',
  })
  @ApiParam({ name: 'id', description: 'id аккаунта из сессии.' })
  @ApiOkResponse({ standardSchema: accountAnswerSchema, example: ACCOUNT_EXAMPLE })
  async getAccount(@Param('id') id: string): Promise<AccountAnswer> {
    const account = await this.accounts.find(id);
    return { account: account && !account.disabled ? account : null };
  }
}
