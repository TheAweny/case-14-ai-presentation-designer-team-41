import type { ResolvedModel } from './model-settings.service.js';

/** Audio the browser recorded. The key never leaves the API. */
export interface SpeechAudio {
  readonly bytes: Buffer;
  readonly type: string;
  readonly name: string;
}

/**
 * OpenAI-compatible `POST /audio/transcriptions`. The caller already resolved the speech role;
 * this function does not check whether the server is up ahead of time.
 */
export async function transcribeSpeech(
  model: ResolvedModel,
  audio: SpeechAudio,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const body = new FormData();
  body.append('file', new Blob([new Uint8Array(audio.bytes)], { type: audio.type }), audio.name);
  body.append('model', model.model);
  const response = await fetchImpl(`${model.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: model.apiKey ? { Authorization: `Bearer ${model.apiKey}` } : {},
    body,
  });
  if (!response.ok) throw new Error(`Transcription failed with HTTP ${response.status}`);
  const payload: unknown = await response.json();
  const text =
    payload && typeof payload === 'object' && 'text' in payload && typeof payload.text === 'string'
      ? payload.text.trim()
      : '';
  if (!text) throw new Error('Transcription returned no text');
  return text;
}
