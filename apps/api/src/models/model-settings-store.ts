import type { Pool } from 'pg';
import type {
  ConnectionCheck,
  ConnectionHeader,
  ConnectionPreset,
  PipelineRole,
  ModelKind,
  ReasoningCapability,
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
  /**
   * Models this connection offers. Null: any model. A row written before the column existed has
   * null.
   */
  readonly enabledModels: readonly string[] | null;
  /** Headers sent with every request besides the key; none for a row written before them. */
  readonly headers: readonly ConnectionHeader[];
  /** The account the connection belongs to; null — shared with everyone by an administrator. */
  readonly ownerId: string | null;
}

/**
 * What probing a model found, by connection, its address and the model id. A field that is
 * missing was not settled. `probeVersion` is the version of the probe prompts that found it.
 */
export interface StoredCapability {
  /** How the model thinks, from the provider's description or the free probe. */
  readonly reasoning?: ReasoningCapability;
  /** The kinds the person set by hand; they win over the provider's description. */
  readonly manualKinds?: readonly ModelKind[];
  readonly probeVersion: string;
}

/**
 * Whose findings: one connection at one address. Not the address alone: a person's own connection
 * to the same server as a shared one must not change what everyone's models are.
 */
export interface CapabilityScope {
  readonly connectionId: string;
  readonly baseUrl: string;
}

/** A stored role: a model or switched off. A role that is not stored is not assigned. */
export type StoredRole = Exclude<RoleAssignment, { kind: 'unassigned' }>;

export interface SettingsEvent {
  readonly userId: string | null;
  readonly action: string;
  readonly connectionId: string | null;
  readonly detail?: Record<string, unknown>;
}

/**
 * Whose roles: an account's own choices, or null for the defaults an administrator set for
 * everyone.
 */
export type RoleOwner = string | null;

export interface ModelSettingsStore {
  /** Shared connections and those of `ownerId`, in the order they were added. */
  listConnections(ownerId: string): Promise<StoredConnection[]>;
  getConnection(connectionId: string): Promise<StoredConnection | null>;
  saveConnection(connection: StoredConnection): Promise<void>;
  /**
   * Removes the connection, the roles assigned to it and what was found about its models; false
   * when there was none.
   */
  deleteConnection(connectionId: string): Promise<boolean>;
  listRoles(owner: RoleOwner): Promise<StoredRole[]>;
  setRole(role: StoredRole, owner: RoleOwner): Promise<void>;
  clearRole(role: PipelineRole, owner: RoleOwner): Promise<void>;
  record(event: SettingsEvent): Promise<void>;
  /**
   * Models the connection from the server environment offers, by its address. Null: any model,
   * also when nothing was stored for this address.
   */
  getServerModels(baseUrl: string): Promise<readonly string[] | null>;
  setServerModels(baseUrl: string, enabledModels: readonly string[] | null): Promise<void>;
  /** The last check of the server connection at this address; null — never checked. */
  getServerCheck(baseUrl: string): Promise<ConnectionCheck | null>;
  setServerCheck(baseUrl: string, check: ConnectionCheck): Promise<void>;
  getCapability(scope: CapabilityScope, modelId: string): Promise<StoredCapability | null>;
  /** Everything found for the models of one connection, by model id. */
  listCapabilities(scope: CapabilityScope): Promise<ReadonlyMap<string, StoredCapability>>;
  /** Stores how the model thinks; the other fields keep their value. */
  saveReasoning(
    scope: CapabilityScope,
    modelId: string,
    reasoning: ReasoningCapability,
    probeVersion: string,
  ): Promise<void>;
  /** Sets or, with null, clears the kinds the person chose by hand. */
  setManualKinds(
    scope: CapabilityScope,
    modelId: string,
    kinds: readonly ModelKind[] | null,
  ): Promise<void>;
}

interface ConnectionRow {
  id: string;
  name: string;
  preset: ConnectionPreset;
  base_url: string;
  api_key_encrypted: string | null;
  last_check: ConnectionCheck | null;
  enabled_models: string[] | null;
  headers: ConnectionHeader[] | null;
  owner_id: string | null;
}

interface RoleRow {
  role: PipelineRole;
  kind: 'model' | 'disabled' | 'default';
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
    enabledModels: row.enabled_models,
    headers: row.headers ?? [],
    ownerId: row.owner_id,
  };
}

function roleOf(row: RoleRow): StoredRole | null {
  if (row.kind === 'default') return { role: row.role, kind: 'default' };
  if (row.kind === 'disabled') return { role: row.role, kind: 'disabled' };
  if (!row.connection_id || !row.model_id) return null;
  return { role: row.role, kind: 'model', connectionId: row.connection_id, modelId: row.model_id };
}

/** Settings in PostgreSQL; the tables come from migration 007 of `@lct/run-store`. */
export class PostgresModelSettingsStore implements ModelSettingsStore {
  constructor(private readonly pool: Pool) {}

  async listConnections(ownerId: string) {
    const result = await this.pool.query<ConnectionRow>(
      `SELECT id, name, preset, base_url, api_key_encrypted, last_check, enabled_models, headers,
              owner_id
       FROM model_connections WHERE owner_id IS NULL OR owner_id = $1
       ORDER BY created_at, id`,
      [ownerId],
    );
    return result.rows.map(connectionOf);
  }

  async getConnection(connectionId: string) {
    const result = await this.pool.query<ConnectionRow>(
      `SELECT id, name, preset, base_url, api_key_encrypted, last_check, enabled_models, headers,
              owner_id
       FROM model_connections WHERE id = $1`,
      [connectionId],
    );
    const row = result.rows[0];
    return row ? connectionOf(row) : null;
  }

  async saveConnection(connection: StoredConnection) {
    await this.pool.query(
      `INSERT INTO model_connections
         (id, name, preset, base_url, api_key_encrypted, last_check, enabled_models, owner_id,
          headers)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, preset = EXCLUDED.preset, base_url = EXCLUDED.base_url,
         api_key_encrypted = EXCLUDED.api_key_encrypted, last_check = EXCLUDED.last_check,
         enabled_models = EXCLUDED.enabled_models, owner_id = EXCLUDED.owner_id,
         headers = EXCLUDED.headers, updated_at = now()`,
      [
        connection.connectionId,
        connection.name,
        connection.preset,
        connection.baseUrl,
        connection.apiKeyEncrypted,
        connection.lastCheck === null ? null : JSON.stringify(connection.lastCheck),
        connection.enabledModels === null ? null : JSON.stringify(connection.enabledModels),
        connection.ownerId,
        JSON.stringify(connection.headers),
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
      await client.query('DELETE FROM model_connection_capabilities WHERE connection_id = $1', [
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

  async listRoles(owner: RoleOwner) {
    const result = await this.pool.query<RoleRow>(
      `SELECT role, kind, connection_id, model_id FROM model_role_assignments
       WHERE owner_id IS NOT DISTINCT FROM $1`,
      [owner],
    );
    return result.rows.map(roleOf).filter((role): role is StoredRole => role !== null);
  }

  async setRole(role: StoredRole, owner: RoleOwner) {
    await this.pool.query(
      `INSERT INTO model_role_assignments (role, kind, connection_id, model_id, owner_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (role, COALESCE(owner_id, '')) DO UPDATE SET
         kind = EXCLUDED.kind, connection_id = EXCLUDED.connection_id,
         model_id = EXCLUDED.model_id, updated_at = now()`,
      [
        role.role,
        role.kind,
        role.kind === 'model' ? role.connectionId : null,
        role.kind === 'model' ? role.modelId : null,
        owner,
      ],
    );
  }

  async clearRole(role: PipelineRole, owner: RoleOwner) {
    await this.pool.query(
      'DELETE FROM model_role_assignments WHERE role = $1 AND owner_id IS NOT DISTINCT FROM $2',
      [role, owner],
    );
  }

  async record(event: SettingsEvent) {
    await this.pool.query(
      `INSERT INTO model_settings_events (user_id, action, connection_id, detail)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [event.userId, event.action, event.connectionId, JSON.stringify(event.detail ?? {})],
    );
  }

  async getServerModels(baseUrl: string) {
    const result = await this.pool.query<{ enabled_models: string[] | null }>(
      'SELECT enabled_models FROM model_server_connection WHERE base_url = $1',
      [baseUrl],
    );
    return result.rows[0]?.enabled_models ?? null;
  }

  async setServerModels(baseUrl: string, enabledModels: readonly string[] | null) {
    await this.pool.query(
      `INSERT INTO model_server_connection (base_url, enabled_models) VALUES ($1, $2::jsonb)
       ON CONFLICT (base_url) DO UPDATE SET
         enabled_models = EXCLUDED.enabled_models, updated_at = now()`,
      [baseUrl, enabledModels === null ? null : JSON.stringify(enabledModels)],
    );
  }

  async getServerCheck(baseUrl: string) {
    const result = await this.pool.query<{ last_check: ConnectionCheck | null }>(
      'SELECT last_check FROM model_server_connection WHERE base_url = $1',
      [baseUrl],
    );
    return result.rows[0]?.last_check ?? null;
  }

  async setServerCheck(baseUrl: string, check: ConnectionCheck) {
    await this.pool.query(
      `INSERT INTO model_server_connection (base_url, last_check) VALUES ($1, $2::jsonb)
       ON CONFLICT (base_url) DO UPDATE SET last_check = EXCLUDED.last_check, updated_at = now()`,
      [baseUrl, JSON.stringify(check)],
    );
  }

  async getCapability(scope: CapabilityScope, modelId: string) {
    return (await this.capabilityRows(scope, modelId)).get(modelId) ?? null;
  }

  async listCapabilities(scope: CapabilityScope) {
    return this.capabilityRows(scope, null);
  }

  private async capabilityRows(scope: CapabilityScope, modelId: string | null) {
    const result = await this.pool.query<{
      model_id: string;
      reasoning: ReasoningCapability | null;
      manual_kinds: ModelKind[] | null;
      probe_version: string;
    }>(
      `SELECT model_id, reasoning, manual_kinds, probe_version
       FROM model_connection_capabilities
       WHERE connection_id = $1 AND base_url = $2 AND ($3::text IS NULL OR model_id = $3)`,
      [scope.connectionId, scope.baseUrl, modelId],
    );
    const found = new Map<string, StoredCapability>();
    for (const row of result.rows) {
      found.set(row.model_id, {
        ...(row.reasoning ? { reasoning: row.reasoning } : {}),
        ...(row.manual_kinds ? { manualKinds: row.manual_kinds } : {}),
        probeVersion: row.probe_version,
      });
    }
    return found;
  }

  async saveReasoning(
    scope: CapabilityScope,
    modelId: string,
    reasoning: ReasoningCapability,
    probeVersion: string,
  ) {
    await this.pool.query(
      `INSERT INTO model_connection_capabilities
         (connection_id, base_url, model_id, reasoning, probe_version)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (connection_id, base_url, model_id) DO UPDATE SET
         reasoning = EXCLUDED.reasoning, probe_version = EXCLUDED.probe_version,
         updated_at = now()`,
      [scope.connectionId, scope.baseUrl, modelId, JSON.stringify(reasoning), probeVersion],
    );
  }

  async setManualKinds(
    scope: CapabilityScope,
    modelId: string,
    kinds: readonly ModelKind[] | null,
  ) {
    await this.pool.query(
      `INSERT INTO model_connection_capabilities
         (connection_id, base_url, model_id, manual_kinds, probe_version)
       VALUES ($1, $2, $3, $4::jsonb, 'manual')
       ON CONFLICT (connection_id, base_url, model_id) DO UPDATE SET
         manual_kinds = EXCLUDED.manual_kinds, updated_at = now()`,
      [scope.connectionId, scope.baseUrl, modelId, kinds === null ? null : JSON.stringify(kinds)],
    );
  }
}

/** Settings in memory, for tests. Behaves like the PostgreSQL store. */
export class MemoryModelSettingsStore implements ModelSettingsStore {
  readonly connections = new Map<string, StoredConnection>();
  /** Roles by owner: '' — the defaults for everyone. */
  readonly roles = new Map<string, Map<PipelineRole, StoredRole>>();
  readonly events: SettingsEvent[] = [];
  readonly serverModels = new Map<string, readonly string[] | null>();
  readonly serverChecks = new Map<string, ConnectionCheck>();
  /** Probe findings by `${connectionId} ${baseUrl} ${modelId}`. */
  readonly capabilities = new Map<string, StoredCapability>();

  private rolesOf(owner: RoleOwner) {
    const key = owner ?? '';
    let roles = this.roles.get(key);
    if (!roles) {
      roles = new Map();
      this.roles.set(key, roles);
    }
    return roles;
  }

  async listConnections(ownerId: string) {
    return [...this.connections.values()].filter(
      (connection) => connection.ownerId === null || connection.ownerId === ownerId,
    );
  }

  async getConnection(connectionId: string) {
    return this.connections.get(connectionId) ?? null;
  }

  async saveConnection(connection: StoredConnection) {
    this.connections.set(connection.connectionId, connection);
  }

  async deleteConnection(connectionId: string) {
    const existed = this.connections.delete(connectionId);
    for (const key of this.capabilities.keys()) {
      if (key.startsWith(`${connectionId} `)) this.capabilities.delete(key);
    }
    for (const roles of this.roles.values()) {
      for (const [role, stored] of roles) {
        if (stored.kind === 'model' && stored.connectionId === connectionId) roles.delete(role);
      }
    }
    return existed;
  }

  async listRoles(owner: RoleOwner) {
    return [...this.rolesOf(owner).values()];
  }

  async setRole(role: StoredRole, owner: RoleOwner) {
    this.rolesOf(owner).set(role.role, role);
  }

  async clearRole(role: PipelineRole, owner: RoleOwner) {
    this.rolesOf(owner).delete(role);
  }

  async record(event: SettingsEvent) {
    this.events.push(event);
  }

  async getServerModels(baseUrl: string) {
    return this.serverModels.get(baseUrl) ?? null;
  }

  async setServerModels(baseUrl: string, enabledModels: readonly string[] | null) {
    this.serverModels.set(baseUrl, enabledModels);
  }

  async getServerCheck(baseUrl: string) {
    return this.serverChecks.get(baseUrl) ?? null;
  }

  async setServerCheck(baseUrl: string, check: ConnectionCheck) {
    this.serverChecks.set(baseUrl, check);
  }

  private static prefix(scope: CapabilityScope) {
    return `${scope.connectionId} ${scope.baseUrl} `;
  }

  async getCapability(scope: CapabilityScope, modelId: string) {
    return this.capabilities.get(MemoryModelSettingsStore.prefix(scope) + modelId) ?? null;
  }

  async listCapabilities(scope: CapabilityScope) {
    const prefix = MemoryModelSettingsStore.prefix(scope);
    const found = new Map<string, StoredCapability>();
    for (const [key, value] of this.capabilities) {
      if (key.startsWith(prefix)) found.set(key.slice(prefix.length), value);
    }
    return found;
  }

  async saveReasoning(
    scope: CapabilityScope,
    modelId: string,
    reasoning: ReasoningCapability,
    probeVersion: string,
  ) {
    const key = MemoryModelSettingsStore.prefix(scope) + modelId;
    this.capabilities.set(key, { ...this.capabilities.get(key), reasoning, probeVersion });
  }

  async setManualKinds(
    scope: CapabilityScope,
    modelId: string,
    kinds: readonly ModelKind[] | null,
  ) {
    const key = MemoryModelSettingsStore.prefix(scope) + modelId;
    const { manualKinds: _, ...rest } = this.capabilities.get(key) ?? { probeVersion: 'manual' };
    this.capabilities.set(key, kinds === null ? rest : { ...rest, manualKinds: kinds });
  }
}
