import {
  ConnectionNotFoundError,
  InvalidModelSettingsError,
  type ConnectionCheck,
  type ConnectionInput,
  type ModelConnection,
  type ModelSettings,
  type ModelSettingsSource,
  type ProbeInput,
  type RoleAssignment,
} from './model-settings';

const api = () =>
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function createHttpModelSettings(userId: string): ModelSettingsSource {
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${api()}${path}`, { ...init, cache: 'no-store' });
    if (response.status === 404) throw new ConnectionNotFoundError('unknown');
    if (response.status === 400) throw new InvalidModelSettingsError();
    if (!response.ok) throw new Error(`Model settings API: ${response.status}`);
    return response.json() as Promise<T>;
  };
  const body = (value: object) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...value, userId }),
  });
  return {
    get: () => request<ModelSettings>(`/model-settings?userId=${encodeURIComponent(userId)}`),
    async saveConnection(input: ConnectionInput) {
      const result = await request<{ connection: ModelConnection }>('/model-settings/connections', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, userId }),
      });
      return result.connection;
    },
    async deleteConnection(connectionId: string) {
      await request(
        `/model-settings/connections/${encodeURIComponent(connectionId)}?userId=${encodeURIComponent(userId)}`,
        { method: 'DELETE' },
      );
    },
    async checkConnection(connectionId: string) {
      const settings = await request<ModelSettings>(
        `/model-settings/connections/${encodeURIComponent(connectionId)}/check`,
        body({}),
      );
      const connection = settings.connections.find((item) => item.connectionId === connectionId);
      if (!connection) throw new ConnectionNotFoundError(connectionId);
      return connection;
    },
    probe: (input: ProbeInput) => request<ConnectionCheck>('/model-settings/probe', body(input)),
    async setRole(assignment: RoleAssignment) {
      await request<ModelSettings>('/model-settings/roles', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...assignment, userId }),
      });
    },
  };
}
