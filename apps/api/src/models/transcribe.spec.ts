import { describe, expect, it, vi } from 'vitest';
import { transcribeSpeech, type SpeechAudio } from './transcribe.js';
import type { ResolvedModel } from './model-settings.service.js';

const model: ResolvedModel = {
  connectionId: 'c',
  baseUrl: 'https://models.example.test/v1/',
  apiKey: 'secret',
  model: 'whisper',
  headers: {},
};

const audio: SpeechAudio = {
  bytes: Buffer.from('audio'),
  type: 'audio/webm',
  name: 'speech.webm',
};

describe('transcribeSpeech', () => {
  it('posts the recording to the configured model and returns its text', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(_url).toBe('https://models.example.test/v1/audio/transcriptions');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer secret');
      const body = init?.body;
      expect(body).toBeInstanceOf(FormData);
      expect((body as FormData).get('model')).toBe('whisper');
      return new Response(JSON.stringify({ text: '  Привет  ' }), { status: 200 });
    });
    await expect(transcribeSpeech(model, audio, fetchImpl as typeof fetch)).resolves.toBe('Привет');
  });

  it('rejects an empty or failed answer', async () => {
    const failed = vi.fn(async () => new Response('no', { status: 500 }));
    await expect(transcribeSpeech(model, audio, failed as typeof fetch)).rejects.toThrow(/500/);
    const empty = vi.fn(async () => new Response(JSON.stringify({ text: '  ' }), { status: 200 }));
    await expect(transcribeSpeech(model, audio, empty as typeof fetch)).rejects.toThrow(/no text/);
  });
});
