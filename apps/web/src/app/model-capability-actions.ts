'use server';

import {
  modelCapabilitiesSchema,
  NO_REASONING_CHOICE,
  type ModelCapabilities,
  type ModelRef,
} from '@lct/contracts';
import { apiFetch } from '@/lib/api';
import { requireAccount } from './auth-session';

/**
 * What a model offers about thinking, as the API learnt it by asking the model. The first ask
 * for a model may take a few seconds while it is probed; later ones come from what the API kept.
 */
export async function getModelCapabilitiesAction(ref: ModelRef): Promise<ModelCapabilities> {
  await requireAccount();
  const query = new URLSearchParams({ connectionId: ref.connectionId, modelId: ref.modelId });
  const response = await apiFetch(`/model-settings/capabilities?${query}`);
  const parsed = response.ok
    ? modelCapabilitiesSchema.safeParse(await response.json().catch(() => null))
    : null;
  return parsed?.success ? parsed.data : { reasoning: NO_REASONING_CHOICE, probed: false };
}

/** Whether dictation works: a speech model is assigned, or one of the connections has one. */
export async function getSpeechAvailableAction(): Promise<boolean> {
  await requireAccount();
  const response = await apiFetch('/speech/model');
  if (!response.ok) return false;
  const payload: unknown = await response.json().catch(() => null);
  return Boolean(
    payload && typeof payload === 'object' && (payload as { available?: unknown }).available,
  );
}
