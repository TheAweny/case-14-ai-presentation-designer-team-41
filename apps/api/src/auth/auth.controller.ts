import { Body, Controller, Get, HttpCode, Post, BadRequestException, Param } from '@nestjs/common';
import { Pool } from 'pg';

interface Credentials {
  readonly email?: unknown;
  readonly password?: unknown;
}

interface AccountRow {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

@Controller('auth')
export class AuthController {
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });

  @Get('accounts')
  async hasAccounts(): Promise<{ hasAccounts: boolean }> {
    const result = await this.pool.query('SELECT 1 FROM app_users LIMIT 1');
    return { hasAccounts: result.rowCount !== 0 };
  }

  @Post('verify')
  @HttpCode(200)
  async verify(@Body() body: Credentials): Promise<AccountRow | null> {
    if (typeof body.email !== 'string' || typeof body.password !== 'string') {
      throw new BadRequestException('Email and password are required.');
    }
    const result = await this.pool.query<AccountRow>(
      `SELECT id, email, name FROM app_users
       WHERE email = lower(trim($1))
         AND password_hash = crypt($2, password_hash)
       LIMIT 1`,
      [body.email, body.password],
    );
    return result.rows[0] ?? null;
  }

  @Get('accounts/:id')
  async getAccount(@Param('id') id: string): Promise<AccountRow | null> {
    const result = await this.pool.query<AccountRow>(
      'SELECT id, email, name FROM app_users WHERE id = $1 LIMIT 1',
      [id],
    );
    return result.rows[0] ?? null;
  }
}
