import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import type { OnApplicationShutdown } from '@nestjs/common';

const digest = (token: string) => createHash('sha256').update(token).digest('hex');
@Injectable()
export class SessionsService implements OnApplicationShutdown {
  readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });
  async onApplicationShutdown() {
    await this.pool.end();
  }
  async rateLimit(email: string) {
    // Neither client forwarded-IP headers nor an untrusted proxy chain determine this key.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const key of ['installation', digest(email.trim().toLowerCase())]) {
        const result = await client.query(
          `INSERT INTO login_windows(key,window_start,attempts)
          VALUES($1,to_timestamp(floor(extract(epoch FROM now())/900)*900),1)
          ON CONFLICT(key,window_start) DO UPDATE SET attempts=login_windows.attempts+1 RETURNING attempts`,
          [key],
        );
        if (result.rows[0].attempts > (key === 'installation' ? 200 : 20)) {
          await client.query('COMMIT');
          throw new HttpException('Слишком много попыток входа. Повторите через 15 минут.', 429);
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async create(accountId: string, password: string) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const eligible = await client.query(
        'SELECT id FROM app_users WHERE id=$1 AND disabled_at IS NULL AND password_hash=crypt($2,password_hash) FOR SHARE',
        [accountId, password],
      );
      if (!eligible.rowCount) throw new UnauthorizedException();
      await client.query(
        'INSERT INTO account_sessions(token_hash,account_id,expires_at) VALUES($1,$2,$3)',
        [digest(token), accountId, expiresAt],
      );
      await client.query('COMMIT');
      return { token, expiresAt };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async owner(token: unknown): Promise<string | null> {
    if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) return null;
    const result = await this.pool.query(
      `SELECT s.account_id FROM account_sessions s JOIN app_users u ON u.id=s.account_id
      WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.disabled_at IS NULL`,
      [digest(token)],
    );
    return result.rows[0]?.account_id ?? null;
  }
  async revoke(token: unknown) {
    if (typeof token === 'string')
      await this.pool.query(
        'UPDATE account_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL',
        [digest(token)],
      );
  }
  async revokeAll(accountId: string, actorId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const actor = await client.query(
        "SELECT id FROM app_users WHERE id=$1 AND role='admin' AND disabled_at IS NULL FOR SHARE",
        [actorId],
      );
      if (!actor.rowCount) throw new ForbiddenException();
      await client.query('SELECT id FROM app_users WHERE id=$1 FOR UPDATE', [accountId]);
      await client.query(
        'UPDATE account_sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL',
        [accountId],
      );
      await client.query(
        "INSERT INTO account_policy_audit(actor_id,scope,before_policy,after_policy,action) VALUES($1,$2,'{}','{}','revoke-sessions')",
        [actorId, accountId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
