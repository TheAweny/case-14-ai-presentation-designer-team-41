import type { Pool } from 'pg';
import type {
  ConnectionCheck,
  ConnectionPreset,
  PipelineRole,
  RoleAssignment,
} from '@lct/contracts';

/** A connection as it is stored: the key only as ciphertext. */
export interface StoredConnection {
  readonly connectionId: string;
  readonly name: string;
  readonly preset: ConnectionPreset;
  readonly baseUrl: string;
  readonly apiKeyEncrypted: string | null;
  readonly lastCheck: ConnectionCheck | null;
}

/** A stored role: a model or switched off. A role that is not stored is not assigned. */
export type StoredRole = Exclude<RoleAssignment, { kind: 'unassigned' }>;

export interface SettingsEvent {
  readonly userId: string | null;
  readonly action: string;
  readonly connectionId: string | null;
  readonly detail?: Record<string, unknown>;
}

export interface ModelSettingsStore {
  /** Connections in the order they were added. */
  listConnections(): Promise<StoredConnection[]>;
  getConnection(connectionId: string): Promise<StoredConnection | null>;
  saveConnection(connection: StoredConnection): Promise<void>;
  /** Removes the connection and the roles assigned to it; false when there was none. */
  deleteConnection(connectionId: string): Promise<boolean>;
  listRoles(): Promise<StoredRole[]>;
  setRole(role: StoredRole): Promise<void>;
  clearRole(role: PipelineRole): Promise<void>;
  record(event: SettingsEvent): Promise<void>;
}

interface ConnectionRow {
  id: string;
  name: string;
  preset: ConnectionPreset;
  base_url: string;
  api_key_encrypted: string | null;
  last_check: ConnectionCheck | null;
}

interface RoleRow {
  role: PipelineRole;
  kind: 'model' | 'disabled';
  connection_id: string | null;
  model_id: string | null;
}

function connectionOf(row: ConnectionRow): StoredConnection {
  return {
    connectionId: row.id,
    name: row.name,
    preset: row.preset,
    baseUrl: row.base_url,
    apiKeyEncrypted: row.api_key_encrypted,
    lastCheck: row.last_check,
  };
}

function roleOf(row: RoleRow): StoredRole | null {
  if (row.kind === 'disabled') return { role: row.role, kind: 'disabled' };
  if (!row.connection_id || !row.model_id) return null;
  return { role: row.role, kind: 'model', connectionId: row.connection_id, modelId: row.model_id };
}

/** Settings in PostgreSQL; the tables come from migration 007 of `@lct/run-store`. */
export class PostgresModelSettingsStore implements ModelSettingsStore {
  constructor(private readonly pool: Pool) {}

  async listConnections() {
    const result = await this.pool.query<ConnectionRow>(
      `SELECT id, name, preset, base_url, api_key_encrypted, last_check
       FROM model_connections ORDER BY created_at, id`,
    );
    return result.rows.map(connectionOf);
  }

  async getConnection(connectionId: string) {
    const result = await this.pool.query<ConnectionRow>(
      `SELECT id, name, preset, base_url, api_key_encrypted, last_check
       FROM model_connections WHERE id = $1`,
      [connectionId],
    );
    const row = result.rows[0];
    return row ? connectionOf(row) : null;
  }

  async saveConnection(connection: StoredConnection) {
    await this.pool.query(
      `INSERT INTO model_connections (id, name, preset, base_url, api_key_encrypted, last_check)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, preset = EXCLUDED.preset, base_url = EXCLUDED.base_url,
         api_key_encrypted = EXCLUDED.api_key_encrypted, last_check = EXCLUDED.last_check,
         updated_at = now()`,
      [
        connection.connectionId,
        connection.name,
        connection.preset,
        connection.baseUrl,
        connection.apiKeyEncrypted,
        connection.lastCheck === null ? null : JSON.stringify(connection.lastCheck),
      ],
    );
  }

  async deleteConnection(connectionId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const removed = await client.query('DELETE FROM model_connections WHERE id = $1', [
        connectionId,
      ]);
      await client.query('DELETE FROM model_role_assignments WHERE connection_id = $1', [
        connectionId,
      ]);
      await client.query('COMMIT');
      return (removed.rowCount ?? 0) > 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listRoles() {
    const result = await this.pool.query<RoleRow>(
      'SELECT role, kind, connection_id, model_id FROM model_role_assignments',
    );
    return result.rows.map(roleOf).filter((role): role is StoredRole => role !== null);
  }

  async setRole(role: StoredRole) {
    await this.pool.query(
      `INSERT INTO model_role_assignments (role, kind, connection_id, model_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (role) DO UPDATE SET
         kind = EXCLUDED.kind, connection_id = EXCLUDED.connection_id,
         model_id = EXCLUDED.model_id, updated_at = now()`,
      [
        role.role,
        role.kind,
        role.kind === 'model' ? role.connectionId : null,
        role.kind === 'model' ? role.modelId : null,
      ],
    );
  }

  async clearRole(role: PipelineRole) {
    await this.pool.query('DELETE FROM model_role_assignments WHERE role = $1', [role]);
  }

  async record(event: SettingsEvent) {
    await this.pool.query(
      `INSERT INTO model_settings_events (user_id, action, connection_id, detail)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [event.userId, event.action, event.connectionId, JSON.stringify(event.detail ?? {})],
    );
  }
}

/** Settings in memory, for tests. Behaves like the PostgreSQL store. */
export class MemoryModelSettingsStore implements ModelSettingsStore {
  readonly connections = new Map<string, StoredConnection>();
  readonly roles = new Map<PipelineRole, StoredRole>();
  readonly events: SettingsEvent[] = [];

  async listConnections() {
    return [...this.connections.values()];
  }

  async getConnection(connectionId: string) {
    return this.connections.get(connectionId) ?? null;
  }

  async saveConnection(connection: StoredConnection) {
    this.connections.set(connection.connectionId, connection);
  }

  async deleteConnection(connectionId: string) {
    const existed = this.connections.delete(connectionId);
    for (const [role, stored] of this.roles) {
      if (stored.kind === 'model' && stored.connectionId === connectionId) this.roles.delete(role);
    }
    return existed;
  }

  async listRoles() {
    return [...this.roles.values()];
  }

  async setRole(role: StoredRole) {
    this.roles.set(role.role, role);
  }

  async clearRole(role: PipelineRole) {
    this.roles.delete(role);
  }

  async record(event: SettingsEvent) {
    this.events.push(event);
  }
}
