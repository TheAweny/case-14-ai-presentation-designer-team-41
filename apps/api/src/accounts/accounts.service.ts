import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { parseAuthUsers } from '../auth/auth-users.js';
import {
  type Account,
  type AccountRole,
  configuredAdmin,
  emailProblem,
  isAccountRole,
  nameProblem,
  normalizeEmail,
  passwordProblem,
  avatarProblem,
} from './account-rules.js';

interface AccountRow {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: AccountRole;
  readonly disabled_at: Date | null;
  readonly created_at: Date;
  readonly avatar: string | null;
}

const COLUMNS = 'id, email, name, role, disabled_at, created_at, avatar';

function accountOf(row: AccountRow): Account {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    disabled: row.disabled_at !== null,
    createdAt: row.created_at.toISOString(),
    avatar: row.avatar ?? null,
  };
}

function refuse(problem: string | null): void {
  if (problem !== null) throw new BadRequestException(problem);
}

/** Changes an administrator may make to an account. A field left out stays as it was. */
export interface AccountPatch {
  readonly email?: unknown;
  readonly name?: unknown;
  readonly password?: unknown;
  readonly role?: unknown;
  readonly disabled?: unknown;
  /** Null — back to the mark the id gives. */
  readonly avatar?: unknown;
}

/**
 * The accounts of the installation. Passwords are bcrypt hashes made by pgcrypto; nothing here
 * returns one.
 *
 * On start the administrator named in `.env` (`ADMIN_EMAIL`, `ADMIN_PASSWORD`) is made if that
 * account does not exist yet. After the first sign-in the password lives in the database and is
 * changed in the interface; a new `ADMIN_PASSWORD` in `.env` replaces it at the next start, which
 * resets a forgotten one. `.env` also brings an administrator back — the account named there is
 * made an administrator and switched on again.
 * `AUTH_USERS`, the older list of accounts, is read the same way: missing accounts are made,
 * nothing else is touched.
 */
@Injectable()
export class AccountsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });
  private readonly logger = new Logger('Accounts');

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.seed();
    } catch (error) {
      this.logger.error(`Could not create the accounts named in .env: ${String(error)}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }

  private async seed(): Promise<void> {
    const admin = configuredAdmin(process.env);
    if (process.env.ADMIN_EMAIL && !admin) {
      this.logger.warn(
        'ADMIN_EMAIL is set but ADMIN_PASSWORD is missing or shorter than 8 characters: no administrator was made.',
      );
    }
    if (admin) {
      await this.pool.query(
        `INSERT INTO app_users (id, email, name, password_hash, role)
         VALUES ($1, $2, $3, crypt($4, gen_salt('bf')), 'admin')
         ON CONFLICT (email) DO UPDATE SET role = 'admin', disabled_at = NULL`,
        [randomUUID(), admin.email, admin.name, admin.password],
      );
      await this.applyEnvPassword(admin.email, admin.password);
    }
    for (const user of parseAuthUsers(process.env.AUTH_USERS)) {
      await this.pool.query(
        `INSERT INTO app_users (id, email, name, password_hash)
         VALUES ($1, $2, $3, crypt($4, gen_salt('bf')))
         ON CONFLICT (email) DO NOTHING`,
        [randomUUID(), user.email, user.name, user.password],
      );
    }
    const admins = await this.pool.query("SELECT 1 FROM app_users WHERE role = 'admin' LIMIT 1");
    if (admins.rowCount === 0) {
      this.logger.warn('There is no administrator: set ADMIN_EMAIL and ADMIN_PASSWORD in .env.');
    }
  }

  /**
   * A password in `.env` other than the one applied last replaces the administrator's password:
   * that is how a forgotten one is reset. The same one leaves the password set in the interface.
   * The first start that sees the account only records what `.env` holds.
   */
  private async applyEnvPassword(email: string, password: string): Promise<void> {
    const result = await this.pool.query<{ known: boolean; same: boolean }>(
      `SELECT env_password_hash IS NOT NULL AS known,
              COALESCE(env_password_hash = crypt($2, env_password_hash), false) AS same
       FROM app_users WHERE email = $1`,
      [email, password],
    );
    const row = result.rows[0];
    if (!row || row.same) return;
    if (!row.known) {
      await this.pool.query(
        `UPDATE app_users SET env_password_hash = crypt($2, gen_salt('bf')) WHERE email = $1`,
        [email, password],
      );
      return;
    }
    await this.pool.query(
      `WITH next AS (SELECT crypt($2, gen_salt('bf')) AS hash)
       UPDATE app_users SET password_hash = next.hash, env_password_hash = next.hash
       FROM next WHERE email = $1`,
      [email, password],
    );
    this.logger.log(`The password of ${email} was reset from ADMIN_PASSWORD in .env.`);
  }

  async hasAccounts(): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM app_users WHERE disabled_at IS NULL LIMIT 1',
    );
    return result.rowCount !== 0;
  }

  /** The account with this password, or null. A switched-off account cannot sign in. */
  async verify(email: string, password: string): Promise<Account | null> {
    const result = await this.pool.query<AccountRow>(
      `SELECT ${COLUMNS} FROM app_users
       WHERE email = $1 AND password_hash = crypt($2, password_hash) AND disabled_at IS NULL
       LIMIT 1`,
      [normalizeEmail(email), password],
    );
    const row = result.rows[0];
    return row ? accountOf(row) : null;
  }

  /** The account, switched off or not, or null. */
  async find(id: string): Promise<Account | null> {
    const result = await this.pool.query<AccountRow>(
      `SELECT ${COLUMNS} FROM app_users WHERE id = $1 LIMIT 1`,
      [id],
    );
    const row = result.rows[0];
    return row ? accountOf(row) : null;
  }

  async list(): Promise<readonly Account[]> {
    const result = await this.pool.query<AccountRow>(
      `SELECT ${COLUMNS} FROM app_users ORDER BY created_at, email`,
    );
    return result.rows.map(accountOf);
  }

  async create(input: {
    email?: unknown;
    name?: unknown;
    password?: unknown;
    role?: unknown;
  }): Promise<Account> {
    refuse(emailProblem(input.email));
    refuse(nameProblem(input.name));
    refuse(passwordProblem(input.password));
    const role = input.role === undefined ? 'user' : input.role;
    if (!isAccountRole(role)) throw new BadRequestException('Unknown role.');
    const result = await this.pool.query<AccountRow>(
      `INSERT INTO app_users (id, email, name, password_hash, role)
       VALUES ($1, $2, $3, crypt($4, gen_salt('bf')), $5)
       ON CONFLICT (email) DO NOTHING
       RETURNING ${COLUMNS}`,
      [
        randomUUID(),
        normalizeEmail(input.email as string),
        (input.name as string).trim(),
        input.password,
        role,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new ConflictException('An account with this email already exists.');
    return accountOf(row);
  }

  /**
   * Change an account. `actorId` is who asks: nobody takes away their own administrator role or
   * switches themselves off, and the last administrator stays one.
   */
  async update(id: string, patch: AccountPatch, actorId: string): Promise<Account> {
    const current = await this.find(id);
    if (!current) throw new NotFoundException('Account not found.');
    if (patch.email !== undefined) refuse(emailProblem(patch.email));
    if (patch.name !== undefined) refuse(nameProblem(patch.name));
    if (patch.password !== undefined) refuse(passwordProblem(patch.password));
    if (patch.avatar !== undefined) refuse(avatarProblem(patch.avatar));
    if (patch.role !== undefined && !isAccountRole(patch.role)) {
      throw new BadRequestException('Unknown role.');
    }
    if (patch.disabled !== undefined && typeof patch.disabled !== 'boolean') {
      throw new BadRequestException('disabled must be a boolean.');
    }
    const demotes = patch.role === 'user' || patch.disabled === true;
    if (demotes && id === actorId) {
      throw new BadRequestException('You cannot demote or switch off your own account.');
    }
    if (demotes && current.role === 'admin') await this.keepAnAdmin(id);

    const result = await this.pool
      .query<AccountRow>(
        `UPDATE app_users SET
           email = COALESCE($2, email),
           name = COALESCE($3, name),
           password_hash = CASE WHEN $4::text IS NULL THEN password_hash
                                ELSE crypt($4, gen_salt('bf')) END,
           role = COALESCE($5, role),
           disabled_at = CASE WHEN $6::boolean IS NULL THEN disabled_at
                              WHEN $6::boolean THEN COALESCE(disabled_at, now()) ELSE NULL END,
           avatar = CASE WHEN $7::boolean THEN $8::text ELSE avatar END
         WHERE id = $1
         RETURNING ${COLUMNS}`,
        [
          id,
          typeof patch.email === 'string' ? normalizeEmail(patch.email) : null,
          typeof patch.name === 'string' ? patch.name.trim() : null,
          typeof patch.password === 'string' ? patch.password : null,
          typeof patch.role === 'string' ? patch.role : null,
          typeof patch.disabled === 'boolean' ? patch.disabled : null,
          patch.avatar !== undefined,
          typeof patch.avatar === 'string' ? patch.avatar : null,
        ],
      )
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === '23505') {
          throw new ConflictException('An account with this email already exists.');
        }
        throw error;
      });
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Account not found.');
    return accountOf(row);
  }

  /** Change one's own password, knowing the current one. */
  async changeOwnPassword(id: string, current: unknown, next: unknown): Promise<void> {
    if (typeof current !== 'string') throw new BadRequestException('Current password is required.');
    refuse(passwordProblem(next));
    const result = await this.pool.query(
      `UPDATE app_users SET password_hash = crypt($3, gen_salt('bf'))
       WHERE id = $1 AND password_hash = crypt($2, password_hash)`,
      [id, current, next],
    );
    if (result.rowCount === 0) throw new BadRequestException('The current password is wrong.');
  }

  /** Refuse, before anything is deleted, an account that may not go. */
  async assertRemovable(id: string, actorId: string): Promise<void> {
    if (id === actorId) throw new BadRequestException('You cannot delete your own account.');
    const current = await this.find(id);
    if (!current) throw new NotFoundException('Account not found.');
    if (current.role === 'admin') await this.keepAnAdmin(id);
  }

  /** Delete the account row; what it owns in the database goes with it (foreign keys). */
  async remove(id: string, actorId: string): Promise<void> {
    await this.assertRemovable(id, actorId);
    await this.pool.query('DELETE FROM app_users WHERE id = $1', [id]);
  }

  private async keepAnAdmin(leaving: string): Promise<void> {
    const others = await this.pool.query(
      "SELECT 1 FROM app_users WHERE role = 'admin' AND disabled_at IS NULL AND id <> $1 LIMIT 1",
      [leaving],
    );
    if (others.rowCount === 0) {
      throw new BadRequestException('The installation must keep at least one administrator.');
    }
  }
}
