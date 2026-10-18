'use server';

import { apiFetch } from '@/lib/api';
import { requireAccount } from './auth-session';

export type TranscriptionResult =
  | { readonly ok: true; readonly text: string }
  | {
      readonly ok: false;
      readonly reason: 'empty' | 'failed';
      /** The provider's HTTP status, when it refused: shown next to the error. */
      readonly detail?: string;
    };

/** The provider's status the API passed on: `HTTP 404`. Its text stays in the API log. */
function failureDetail(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const { status } = payload as { status?: unknown };
  return typeof status === 'number' ? `HTTP ${status}` : undefined;
}

/**
 * Send a recording to the API. The model and its key stay on the API; this action only forwards
 * the bytes for the signed-in account.
 */
export async function transcribeSpeechAction(formData: FormData): Promise<TranscriptionResult> {
  await requireAccount();
  const audio = formData.get('audio');
  if (!(audio instanceof File) || audio.size === 0) return { ok: false, reason: 'empty' };
  const body = new FormData();
  body.set('file', audio, audio.name || 'speech.webm');
  const response = await apiFetch('/speech/transcriptions', { method: 'POST', body });
  if (!response.ok) {
    const detail = failureDetail(await response.json().catch(() => null));
    return { ok: false, reason: 'failed', ...(detail ? { detail } : {}) };
  }
  const payload: unknown = await response.json().catch(() => null);
  const text =
    payload && typeof payload === 'object' && 'text' in payload && typeof payload.text === 'string'
      ? payload.text.trim()
      : '';
  return text ? { ok: true, text } : { ok: false, reason: 'failed' };
}
