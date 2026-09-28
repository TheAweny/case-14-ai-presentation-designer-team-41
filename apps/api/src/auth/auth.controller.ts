import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  type OnApplicationBootstrap,
  Param,
  Post,
} from '@nestjs/common';
import { Pool } from 'pg';
import { parseAuthUsers } from './auth-users.js';

interface Credentials {
  readonly email?: unknown;
  readonly password?: unknown;
}

interface AccountRow {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

/**
 * Every answer is a JSON object. An unknown account is `{ "account": null }` rather than an
 * empty 200, which a client reading JSON cannot tell from a broken response.
 */
interface AccountAnswer {
  readonly account: AccountRow | null;
}

@Controller('auth')
export class AuthController implements OnApplicationBootstrap {
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });
  private readonly logger = new Logger('Auth');

  /**
   * Loads AUTH_USERS into app_users once migrations have run. When the list is set it is the
   * source of truth: listed accounts are created or updated, others removed. Unset, the table
   * is left as it is.
   */
  async onApplicationBootstrap(): Promise<void> {
    const users = parseAuthUsers(process.env.AUTH_USERS);
    if (users.length === 0) {
      return;
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const user of users) {
        await client.query(
          `INSERT INTO app_users (id, email, name, password_hash)
           VALUES ($1, $1, $2, crypt($3, gen_salt('bf')))
           ON CONFLICT (email) DO UPDATE SET
             name = EXCLUDED.name,
             password_hash = CASE
               WHEN app_users.password_hash = crypt($3, app_users.password_hash)
                 THEN app_users.password_hash
               ELSE EXCLUDED.password_hash
             END`,
          [user.email, user.name, user.password],
        );
      }
      await client.query('DELETE FROM app_users WHERE NOT (email = ANY($1::text[]))', [
        users.map((user) => user.email),
      ]);
      await client.query('COMMIT');
      this.logger.log(`Accounts loaded from AUTH_USERS: ${users.length}`);
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error(`Could not load AUTH_USERS: ${String(error)}`);
    } finally {
      client.release();
    }
  }

  @Get('accounts')
  async hasAccounts(): Promise<{ hasAccounts: boolean }> {
    const result = await this.pool.query('SELECT 1 FROM app_users LIMIT 1');
    return { hasAccounts: result.rowCount !== 0 };
  }

  @Post('verify')
  @HttpCode(200)
  async verify(@Body() body: Credentials): Promise<AccountAnswer> {
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
    return { account: result.rows[0] ?? null };
  }

  @Get('accounts/:id')
  async getAccount(@Param('id') id: string): Promise<AccountAnswer> {
    const result = await this.pool.query<AccountRow>(
      'SELECT id, email, name FROM app_users WHERE id = $1 LIMIT 1',
      [id],
    );
    return { account: result.rows[0] ?? null };
  }
}
