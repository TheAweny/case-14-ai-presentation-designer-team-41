import { generationUsageSchema, type GenerationUsage } from '@lct/contracts';
import { apiFetch } from './api';

const pending = new Map<string, Promise<GenerationUsage | null>>();
/** Share concurrent card reads. Reading this endpoint never dispatches a model. */
export function readGenerationUsage(runId: string): Promise<GenerationUsage | null> {
  const current = pending.get(runId);
  if (current) return current;
  const request = apiFetch(`/generation/${encodeURIComponent(runId)}/usage`, {
    signal: AbortSignal.timeout(10000),
  })
    .then(async (response) =>
      response.ok ? generationUsageSchema.parse(await response.json()) : null,
    )
    .catch(() => null)
    .finally(() => pending.delete(runId));
  pending.set(runId, request);
  return request;
}
