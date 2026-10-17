import type { ResolvedModel } from './model-settings.service.js';

/** Audio the browser recorded. The key never leaves the API. */
export interface SpeechAudio {
  readonly bytes: Buffer;
  readonly type: string;
  readonly name: string;
}

/** A provider refused the recording: its status and what it said, for the person to read. */
export class TranscriptionError extends Error {
  constructor(
    readonly status: number | null,
    readonly detail: string,
  ) {
    super(status === null ? detail : `Transcription failed with HTTP ${status}: ${detail}`);
  }
}

/** Whisper reads the format from the file name, so the name follows what the browser recorded. */
const EXTENSIONS: Readonly<Record<string, string>> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

/** One minute: a long dictation on a busy provider, short of the browser giving up. */
const TIMEOUT_MS = 60000;

/** The provider's own words, without the noise around them: an error message or the first text. */
async function providerDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const payload = JSON.parse(text) as {
      error?: { message?: unknown } | string;
      message?: unknown;
    };
    const message =
      typeof payload.error === 'string'
        ? payload.error
        : typeof payload.error?.message === 'string'
          ? payload.error.message
          : typeof payload.message === 'string'
            ? payload.message
            : null;
    if (message) return message.slice(0, 300);
  } catch {
    // Not JSON: the text itself, shortened.
  }
  return text.trim().slice(0, 300) || response.statusText || 'no details';
}

/**
 * OpenAI-compatible `POST /audio/transcriptions`. The caller already resolved the speech model;
 * this function does not check whether the server is up ahead of time.
 */
export async function transcribeSpeech(
  model: ResolvedModel,
  audio: SpeechAudio,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  // `audio/webm;codecs=opus` from Chromium: some gateways match the bare type only.
  const type = audio.type.split(';')[0]?.trim().toLowerCase() || 'audio/webm';
  const name = `speech.${EXTENSIONS[type] ?? audio.name.split('.').pop() ?? 'webm'}`;
  const body = new FormData();
  body.append('file', new Blob([new Uint8Array(audio.bytes)], { type }), name);
  body.append('model', model.model);
  let response: Response;
  try {
    response = await fetchImpl(`${model.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        ...model.headers,
        ...(model.apiKey ? { Authorization: `Bearer ${model.apiKey}` } : {}),
      },
      body,
      // A redirect would carry the key to wherever the server points; refuse it instead.
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new TranscriptionError(
      null,
      error instanceof Error && error.name === 'TimeoutError'
        ? 'the provider did not answer in time'
        : 'the provider could not be reached',
    );
  }
  if (!response.ok) throw new TranscriptionError(response.status, await providerDetail(response));
  const payload: unknown = await response.json().catch(() => null);
  const text =
    payload && typeof payload === 'object' && 'text' in payload && typeof payload.text === 'string'
      ? payload.text.trim()
      : '';
  if (!text) throw new TranscriptionError(response.status, 'Transcription returned no text');
  return text;
}
