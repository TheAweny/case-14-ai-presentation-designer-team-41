'use client';

import { useEffect, useSyncExternalStore } from 'react';
import type { ModelCapabilities, ModelRef } from '@lct/contracts';
import { getModelCapabilitiesAction } from '@/app/model-capability-actions';

/**
 * What each model offers, as the API found by probing it, for this tab. A model the API could not
 * probe yet is not kept, so the next field that shows it asks again.
 */
const known = new Map<string, ModelCapabilities>();
const asking = new Set<string>();
const listeners = new Set<() => void>();

const keyOf = (ref: ModelRef) => `${ref.connectionId}\n${ref.modelId}`;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function ask(ref: ModelRef): void {
  const key = keyOf(ref);
  if (known.has(key) || asking.has(key)) return;
  asking.add(key);
  getModelCapabilitiesAction(ref)
    .then((found) => {
      if (found.probed) known.set(key, found);
      for (const listener of listeners) listener();
    })
    .catch(() => undefined)
    .finally(() => asking.delete(key));
}

/** What the model offers about thinking; null while it is being asked or could not be probed. */
export function useModelCapabilities(ref: ModelRef | null): ModelCapabilities | null {
  const key = ref ? keyOf(ref) : null;
  const found = useSyncExternalStore(
    subscribe,
    () => (key ? (known.get(key) ?? null) : null),
    () => null,
  );
  const connectionId = ref?.connectionId;
  const modelId = ref?.modelId;
  useEffect(() => {
    if (connectionId && modelId) ask({ connectionId, modelId });
  }, [connectionId, modelId]);
  return found;
}
