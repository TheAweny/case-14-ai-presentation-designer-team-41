import {
  connectionCheckSchema,
  modelConnectionSchema,
  modelSettingsErrorSchema,
  modelSettingsSchema,
} from '@lct/contracts';
import { apiFetch } from './api';
import {
  ConnectionNotFoundError,
  InvalidModelSettingsError,
  ModelKeysUnavailableError,
  type ModelSettingsSource,
} from './model-settings';

/**
 * Model settings kept by the API. Called only from the server actions of the settings window,
 * for the signed-in account: the API records who changed what. Keys go to the API when a form is
 * saved and never come back — every answer is parsed with schemas that have no field for them.
 */
export function createApiModelSettings(userId: string): ModelSettingsSource {
  const call = async (path: string, init: RequestInit = {}): Promise<unknown> => {
    const response = await apiFetch(
      `/model-settings${path}`,
      {
        ...init,
        headers: init.body ? { 'content-type': 'application/json' } : undefined,
      },
      { userId },
    );
    if (response.ok) return response.status === 204 ? undefined : response.json();
    const refusal = modelSettingsErrorSchema.safeParse(await response.json().catch(() => ({})));
    if (refusal.success) {
      const { reason, problems } = refusal.data;
      if (reason === 'notFound') throw new ConnectionNotFoundError(path.split('/')[2] ?? '');
      if (reason === 'invalid') throw new InvalidModelSettingsError(problems);
      if (reason === 'managed') throw new InvalidModelSettingsError();
      if (reason === 'unavailable') throw new ModelKeysUnavailableError();
    }
    throw new Error(`Model settings API: HTTP ${response.status}`);
  };
  const json = (value: unknown) => JSON.stringify(value);

  return {
    async get() {
      return modelSettingsSchema.parse(await call(''));
    },
    async saveConnection(input) {
      return modelConnectionSchema.parse(
        await call('/connections', { method: 'POST', body: json(input) }),
      );
    },
    async deleteConnection(connectionId) {
      await call(`/connections/${encodeURIComponent(connectionId)}`, { method: 'DELETE' });
    },
    async checkConnection(connectionId) {
      return modelConnectionSchema.parse(
        await call(`/connections/${encodeURIComponent(connectionId)}/check`, { method: 'POST' }),
      );
    },
    async probe(input) {
      return connectionCheckSchema.parse(
        await call('/probe', { method: 'POST', body: json(input) }),
      );
    },
    async setRole(assignment) {
      await call('/roles', { method: 'PUT', body: json(assignment) });
    },
    async setConnectionModels(input) {
      return modelConnectionSchema.parse(
        await call(`/connections/${encodeURIComponent(input.connectionId)}/models`, {
          method: 'PUT',
          body: json({ enabledModels: input.enabledModels }),
        }),
      );
    },
  };
}
