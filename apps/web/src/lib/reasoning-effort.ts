import { REASONING_EFFORTS, type ReasoningEffort } from '@lct/contracts';

const KEY = 'lct.reasoningEffort';
const listeners = new Set<() => void>();

/** The depth the composer last chose. Absent outside the browser, so tests send no preference. */
export function readReasoningEffort(): ReasoningEffort | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(KEY);
    if (REASONING_EFFORTS.some((level) => level === value)) return value as ReasoningEffort;
  } catch {
    return 'high';
  }
  return 'high';
}

export function writeReasoningEffort(value: ReasoningEffort): void {
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    // The choice still applies for this open menu.
  }
  for (const listener of listeners) listener();
}

export function subscribeReasoningEffort(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
